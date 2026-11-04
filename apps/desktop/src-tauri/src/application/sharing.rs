//! The server-side sharing use case: which local queues are shared, and how the UI sees them.
//!
//! The use case owns the selection and the rules around it; the spooler and the network live in
//! adapters (`adapters::printers`, `adapters::ipps`).

use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use tokio::sync::watch;

use crate::application::{LocalPrinterCatalog, SharedPrinterSource};
use crate::domain::{AppError, PrinterName, SharedPrinters};

/// File that records the user's selected shared printers and sharing state.
const SETTINGS_FILE: &str = "sharing_state.json";

/// A user-configured custom paper size shared with clients alongside the built-in catalog.
///
/// Dimensions are stored in tenths of a millimetre with the short side first. The advertised IPP
/// keyword is derived as `custom_<w>x<h>mm` (see `media::custom_keyword`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CustomMedia {
    /// A human-readable label shown in the sharing settings; not the advertised keyword.
    pub label: String,
    pub short_tenths_mm: i16,
    pub long_tenths_mm: i16,
}

impl CustomMedia {
    /// Validates the label and dimensions, and normalises the sides so the short side is first.
    fn validate(&self) -> Result<(), AppError> {
        let label = self.label.trim();
        if label.is_empty() {
            return Err(AppError::invalid_input("custom media label cannot be empty"));
        }
        if label.len() > 80 {
            return Err(AppError::invalid_input("custom media label is too long"));
        }
        let (short, long) = self.sorted_sides();
        if !crate::adapters::printers::media::custom_dimensions_are_supported(short, long) {
            return Err(AppError::invalid_input(format!(
                "custom media {short}x{long} (tenths mm) is outside the supported range (50mm to 330.2x450mm)"
            )));
        }
        Ok(())
    }

    fn sorted_sides(&self) -> (i16, i16) {
        (
            self.short_tenths_mm.min(self.long_tenths_mm),
            self.short_tenths_mm.max(self.long_tenths_mm),
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct SavedSharing {
    enabled: bool,
    printers: Vec<String>,
    #[serde(default)]
    custom_media: Vec<CustomMedia>,
}

/// One local queue as the UI lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalPrinter {
    name: PrinterName,
    shared: bool,
}

impl LocalPrinter {
    /// One local queue and whether the server shares it.
    pub fn new(name: PrinterName, shared: bool) -> Self {
        Self { name, shared }
    }

    pub fn name(&self) -> &PrinterName {
        &self.name
    }

    /// Whether the server currently shares this queue with clients.
    pub fn shared(&self) -> bool {
        self.shared
    }
}

/// The local queues the server user chose to share.
///
/// The selection lives here whether or not sharing runs, and it is published as it changes: the
/// endpoint reads it on every request, and the discovery advertisement follows it (#36).
pub struct Sharing {
    catalog: Arc<dyn LocalPrinterCatalog>,
    selection: RwLock<SharedPrinters>,
    changes: watch::Sender<SharedPrinters>,
    preference_path: Option<PathBuf>,
    enabled: RwLock<bool>,
    custom_media: RwLock<Vec<CustomMedia>>,
}

impl Sharing {
    pub fn new(catalog: Arc<dyn LocalPrinterCatalog>) -> Self {
        Self::with_persistence(catalog, None)
    }

    /// Initializes sharing, restoring previously saved printer selection and enabled state if available.
    pub fn with_persistence(
        catalog: Arc<dyn LocalPrinterCatalog>,
        data_dir: Option<&Path>,
    ) -> Self {
        let preference_path = data_dir.map(|dir| dir.join(SETTINGS_FILE));
        let saved = preference_path
            .as_ref()
            .and_then(|path| match std::fs::read(path) {
                Ok(bytes) => match serde_json::from_slice::<SavedSharing>(&bytes) {
                    Ok(settings) => Some(settings),
                    Err(error) => {
                        log::warn!("saved server sharing settings could not be read: {error}");
                        None
                    }
                },
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(error) => {
                    log::warn!("cannot read server sharing settings: {error}");
                    None
                }
            });

        let (enabled, initial_printers, initial_custom_media) = match saved {
            Some(settings) => {
                let names: Vec<PrinterName> = settings
                    .printers
                    .iter()
                    .filter_map(|s| PrinterName::parse(s).ok())
                    .collect();
                let custom_media = settings
                    .custom_media
                    .into_iter()
                    .filter(|media| media.validate().is_ok())
                    .collect();
                (
                    settings.enabled,
                    SharedPrinters::new(names),
                    custom_media,
                )
            }
            None => (false, SharedPrinters::default(), Vec::new()),
        };

        let (changes, _) = watch::channel(initial_printers.clone());
        Self {
            catalog,
            selection: RwLock::new(initial_printers),
            changes,
            preference_path,
            enabled: RwLock::new(enabled),
            custom_media: RwLock::new(initial_custom_media),
        }
    }

    /// Follows the selection; the receiver also holds the current selection.
    pub fn subscribe(&self) -> watch::Receiver<SharedPrinters> {
        self.changes.subscribe()
    }

    /// Every local queue with its sharing state, ordered by queue name.
    pub async fn local_printers(&self) -> Result<Vec<LocalPrinter>, AppError> {
        let queues = self.catalog.local_printers().await?;
        let selected = self.selected()?;
        Ok(queues
            .into_iter()
            .map(|name| {
                let shared = selected.contains(&name);
                LocalPrinter::new(name, shared)
            })
            .collect())
    }

    /// Replaces the selection with `names` and returns the resulting list of local queues.
    ///
    /// Every name must be a local queue: sharing a queue the spooler does not report would leave
    /// clients with a printer that can never accept a job.
    pub async fn set_shared(&self, names: Vec<PrinterName>) -> Result<Vec<LocalPrinter>, AppError> {
        let queues = self.catalog.local_printers().await?;
        for name in &names {
            if !queues.contains(name) {
                return Err(AppError::invalid_input(format!(
                    "'{name}' is not a local printer queue"
                )));
            }
        }

        let selection = SharedPrinters::new(names);
        {
            let mut current = self
                .selection
                .write()
                .map_err(|_| AppError::internal("printer selection lock is poisoned"))?;
            *current = selection.clone();
        }
        // Only a real change is published: re-selecting the same queues must not make the endpoint
        // or the advertisement do work again.
        if *self.changes.borrow() != selection {
            self.changes.send_replace(selection);
        }
        self.persist()?;
        self.local_printers().await
    }

    /// Records whether sharing was explicitly started or stopped, and persists the choice.
    pub fn set_sharing_enabled(&self, enabled: bool) -> Result<(), AppError> {
        {
            let mut current = self
                .enabled
                .write()
                .map_err(|_| AppError::internal("printer selection lock is poisoned"))?;
            *current = enabled;
        }
        self.persist()
    }

    /// Whether server sharing should be automatically started on startup.
    ///
    /// Sharing autostarts only if sharing was enabled before restart AND at least one valid shared printer exists.
    pub fn is_autostart_enabled(&self) -> bool {
        let enabled = self.enabled.read().map(|e| *e).unwrap_or(false);
        let has_printers = !self.shared_printers().is_empty();
        enabled && has_printers
    }

    /// Restores the saved selection against the currently available local queues.
    ///
    /// Filters out missing queues from the selection. If at least one valid printer remains,
    /// sharing will autostart if enabled was true. If all saved printers are gone,
    /// the selection is empty and autostart will be false.
    pub async fn restore(&self) -> Result<(), AppError> {
        let queues = self.catalog.local_printers().await?;
        if queues.is_empty() {
            log::info!("local printer catalog reported no queues during restore; preserving saved selection");
            return Ok(());
        }
        let mut updated_selection = Vec::new();
        let mut changed = false;
        {
            let current = self
                .selection
                .read()
                .map_err(|_| AppError::internal("printer selection lock is poisoned"))?;
            for printer in current.as_slice() {
                if queues.contains(printer) {
                    updated_selection.push(printer.clone());
                } else {
                    log::info!("filtered out removed printer: {}", printer.as_str());
                    changed = true;
                }
            }
        }

        if changed {
            let selection = SharedPrinters::new(updated_selection);
            if selection.is_empty() {
                if let Ok(mut enabled) = self.enabled.write() {
                    *enabled = false;
                }
            }
            {
                let mut current = self
                    .selection
                    .write()
                    .map_err(|_| AppError::internal("printer selection lock is poisoned"))?;
                *current = selection.clone();
            }
            if *self.changes.borrow() != selection {
                self.changes.send_replace(selection);
            }
            self.persist()?;
        }
        Ok(())
    }

    /// Persists current sharing settings to disk.
    fn persist(&self) -> Result<(), AppError> {
        let Some(path) = &self.preference_path else {
            return Ok(());
        };
        let printers: Vec<String> = {
            let selection = self
                .selection
                .read()
                .map_err(|_| AppError::internal("printer selection lock is poisoned"))?;
            selection
                .as_slice()
                .iter()
                .map(|n| n.as_str().to_string())
                .collect()
        };
        let enabled = self
            .enabled
            .read()
            .map_err(|_| AppError::internal("printer selection lock is poisoned"))?;
        let custom_media = self
            .custom_media
            .read()
            .map_err(|_| AppError::internal("custom media lock is poisoned"))?;
        let saved = SavedSharing {
            enabled: *enabled,
            printers,
            custom_media: custom_media.clone(),
        };
        let bytes = serde_json::to_vec(&saved)
            .map_err(|_| AppError::internal("cannot serialize server sharing settings"))?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|_| AppError::internal("cannot create settings directory"))?;
        }
        std::fs::write(path, bytes)
            .map_err(|_| AppError::internal("cannot write server sharing settings"))?;
        Ok(())
    }

    /// The queues currently shared with clients.
    pub fn selected(&self) -> Result<SharedPrinters, AppError> {
        self.selection
            .read()
            .map(|selection| selection.clone())
            .map_err(|_| AppError::internal("printer selection lock is poisoned"))
    }

    /// The user-configured custom paper sizes, in the order they were added.
    pub fn list_custom_media(&self) -> Vec<CustomMedia> {
        self.custom_media
            .read()
            .map(|media| media.clone())
            .unwrap_or_default()
    }

    /// Adds a custom paper size and returns the resulting list.
    ///
    /// The label must be unique and the dimensions must fall within the supported range; both are
    /// validated before the entry is stored and persisted.
    pub fn add_custom_media(&self, media: CustomMedia) -> Result<Vec<CustomMedia>, AppError> {
        let media = CustomMedia {
            label: media.label.trim().to_owned(),
            short_tenths_mm: media.short_tenths_mm,
            long_tenths_mm: media.long_tenths_mm,
        };
        media.validate()?;
        {
            let mut current = self
                .custom_media
                .write()
                .map_err(|_| AppError::internal("custom media lock is poisoned"))?;
            if current
                .iter()
                .any(|existing| existing.label.eq_ignore_ascii_case(&media.label))
            {
                return Err(AppError::invalid_input(format!(
                    "a custom media size named '{}' already exists",
                    media.label
                )));
            }
            current.push(media);
        }
        self.persist()?;
        Ok(self.list_custom_media())
    }

    /// Removes a custom paper size by label and returns the resulting list.
    pub fn remove_custom_media(&self, label: &str) -> Result<Vec<CustomMedia>, AppError> {
        {
            let mut current = self
                .custom_media
                .write()
                .map_err(|_| AppError::internal("custom media lock is poisoned"))?;
            current.retain(|media| !media.label.eq_ignore_ascii_case(label));
        }
        self.persist()?;
        Ok(self.list_custom_media())
    }
}

impl SharedPrinterSource for Sharing {
    fn shared_printers(&self) -> Vec<PrinterName> {
        self.selection
            .read()
            .map(|selection| selection.as_slice().to_vec())
            .unwrap_or_default()
    }

    fn custom_media(&self) -> Vec<crate::adapters::printers::media::AdvertisedMedia> {
        use crate::adapters::printers::media::AdvertisedMedia;
        self.list_custom_media()
            .iter()
            .map(|media| {
                let (short, long) = media.sorted_sides();
                AdvertisedMedia::custom(short, long)
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ErrorCode;
    use crate::test_support::temporary_directory;
    use async_trait::async_trait;
    use std::time::Duration;

    /// A catalog over a fixed set of queues.
    struct FakeCatalog {
        queues: Vec<PrinterName>,
    }

    impl FakeCatalog {
        fn new(names: &[&str]) -> Arc<Self> {
            Arc::new(Self {
                queues: names
                    .iter()
                    .map(|name| PrinterName::parse(name).expect("valid name"))
                    .collect(),
            })
        }
    }

    #[async_trait]
    impl LocalPrinterCatalog for FakeCatalog {
        async fn local_printers(&self) -> Result<Vec<PrinterName>, AppError> {
            Ok(self.queues.clone())
        }
    }

    fn sharing(names: &[&str]) -> Sharing {
        Sharing::new(FakeCatalog::new(names))
    }

    fn name(value: &str) -> PrinterName {
        PrinterName::parse(value).expect("valid name")
    }

    #[tokio::test]
    async fn nothing_is_shared_until_the_user_selects_queues() {
        let sharing = sharing(&["HP LaserJet", "Zebra"]);

        let printers = sharing.local_printers().await.expect("lists queues");

        assert_eq!(printers.len(), 2);
        assert!(printers.iter().all(|printer| !printer.shared()));
        assert_eq!(printers[0].name().as_str(), "HP LaserJet");
        assert!(sharing.selected().expect("selection").is_empty());
        assert!(sharing.shared_printers().is_empty());
    }

    #[tokio::test]
    async fn the_user_can_share_several_queues_at_once() {
        let sharing = sharing(&["HP LaserJet", "Zebra", "Canon"]);

        let printers = sharing
            .set_shared(vec![name("Zebra"), name("Canon")])
            .await
            .expect("selects queues");

        let shared: Vec<&str> = printers
            .iter()
            .filter(|printer| printer.shared())
            .map(|printer| printer.name().as_str())
            .collect();
        assert_eq!(shared, vec!["Zebra", "Canon"]);
        assert_eq!(
            sharing
                .shared_printers()
                .iter()
                .map(PrinterName::as_str)
                .collect::<Vec<_>>(),
            vec!["Zebra", "Canon"]
        );
    }

    #[tokio::test]
    async fn sharing_a_queue_the_spooler_does_not_report_is_rejected() {
        let sharing = sharing(&["HP LaserJet"]);
        sharing
            .set_shared(vec![name("HP LaserJet")])
            .await
            .expect("selects a local queue");

        let error = sharing
            .set_shared(vec![name("HP LaserJet"), name("Ghost")])
            .await
            .expect_err("rejected");

        assert_eq!(error.code(), ErrorCode::InvalidInput);
        assert_eq!(error.message(), "'Ghost' is not a local printer queue");
        // The rejected request must not change what clients see.
        assert_eq!(
            sharing
                .shared_printers()
                .iter()
                .map(PrinterName::as_str)
                .collect::<Vec<_>>(),
            vec!["HP LaserJet"]
        );
    }

    #[tokio::test]
    async fn the_selection_can_be_cleared() {
        let sharing = sharing(&["HP LaserJet"]);
        sharing
            .set_shared(vec![name("HP LaserJet")])
            .await
            .expect("selects a queue");

        let printers = sharing.set_shared(Vec::new()).await.expect("clears");

        assert!(printers.iter().all(|printer| !printer.shared()));
        assert!(sharing.selected().expect("selection").is_empty());
    }

    #[tokio::test]
    async fn a_subscriber_follows_the_selection_while_sharing_runs() {
        let sharing = sharing(&["HP LaserJet", "Zebra"]);
        let mut changes = sharing.subscribe();
        assert!(changes.borrow_and_update().is_empty());

        sharing
            .set_shared(vec![name("Zebra")])
            .await
            .expect("selects a queue");
        changes.changed().await.expect("publishes the selection");
        assert_eq!(changes.borrow_and_update().as_slice(), &[name("Zebra")]);

        // Selecting what is already selected is not worth waking anything up for.
        sharing
            .set_shared(vec![name("Zebra")])
            .await
            .expect("selects the same queue");
        assert!(
            tokio::time::timeout(Duration::from_millis(50), changes.changed())
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn selection_changes_are_visible_while_sharing_runs() {
        let sharing = sharing(&["HP LaserJet", "Zebra"]);

        sharing
            .set_shared(vec![name("Zebra")])
            .await
            .expect("selects a queue");
        assert_eq!(sharing.shared_printers(), vec![name("Zebra")]);

        sharing
            .set_shared(vec![name("HP LaserJet")])
            .await
            .expect("changes the selection");
        assert_eq!(sharing.shared_printers(), vec![name("HP LaserJet")]);
    }

    #[tokio::test]
    async fn selection_and_enabled_state_persist_across_reloads() {
        let path = temporary_directory("persist-reload");

        let sharing1 =
            Sharing::with_persistence(FakeCatalog::new(&["HP LaserJet", "Zebra"]), Some(&path));
        sharing1
            .set_shared(vec![name("Zebra")])
            .await
            .expect("selects Zebra");
        sharing1.set_sharing_enabled(true).expect("enables sharing");

        // Reload from same path
        let sharing2 =
            Sharing::with_persistence(FakeCatalog::new(&["HP LaserJet", "Zebra"]), Some(&path));
        assert_eq!(sharing2.shared_printers(), vec![name("Zebra")]);
        assert!(sharing2.is_autostart_enabled());

        std::fs::remove_dir_all(&path).ok();
    }

    #[tokio::test]
    async fn custom_media_can_be_added_and_removed() {
        let sharing = sharing(&["HP LaserJet"]);

        let initial = sharing.list_custom_media();
        assert!(initial.is_empty());

        let after_add = sharing
            .add_custom_media(CustomMedia {
                label: "Receipt 80x120mm".to_owned(),
                short_tenths_mm: 800,
                long_tenths_mm: 1200,
            })
            .expect("adds custom media");
        assert_eq!(after_add.len(), 1);
        assert_eq!(after_add[0].label, "Receipt 80x120mm");

        // Advertised media expose the derived keyword.
        let advertised = sharing.custom_media();
        assert_eq!(advertised.len(), 1);
        assert_eq!(advertised[0].keyword, "custom_80x120mm");
        assert_eq!(advertised[0].paper_id, 256);

        let after_remove = sharing
            .remove_custom_media("receipt 80x120mm")
            .expect("removes case-insensitively");
        assert!(after_remove.is_empty());
        assert!(sharing.custom_media().is_empty());
    }

    #[tokio::test]
    async fn custom_media_validates_dimensions_and_unique_labels() {
        let sharing = sharing(&["HP LaserJet"]);

        let out_of_range = sharing.add_custom_media(CustomMedia {
            label: "Tiny".to_owned(),
            short_tenths_mm: 100,
            long_tenths_mm: 150,
        });
        assert_eq!(out_of_range.expect_err("rejected").code(), ErrorCode::InvalidInput);

        sharing
            .add_custom_media(CustomMedia {
                label: "Receipt".to_owned(),
                short_tenths_mm: 1000,
                long_tenths_mm: 1500,
            })
            .expect("adds first");
        let duplicate = sharing.add_custom_media(CustomMedia {
            label: "receipt".to_owned(),
            short_tenths_mm: 1000,
            long_tenths_mm: 1500,
        });
        assert_eq!(
            duplicate.expect_err("rejected").code(),
            ErrorCode::InvalidInput
        );
    }

    #[tokio::test]
    async fn custom_media_persists_across_reloads() {
        let path = temporary_directory("persist-custom-media");

        let sharing1 =
            Sharing::with_persistence(FakeCatalog::new(&["HP LaserJet"]), Some(&path));
        sharing1
            .add_custom_media(CustomMedia {
                label: "Label 100x150mm".to_owned(),
                short_tenths_mm: 1000,
                long_tenths_mm: 1500,
            })
            .expect("adds custom media");

        let sharing2 =
            Sharing::with_persistence(FakeCatalog::new(&["HP LaserJet"]), Some(&path));
        let restored = sharing2.list_custom_media();
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].label, "Label 100x150mm");
        assert_eq!(restored[0].short_tenths_mm, 1000);
        assert_eq!(restored[0].long_tenths_mm, 1500);

        std::fs::remove_dir_all(&path).ok();
    }

    #[tokio::test]
    async fn explicitly_stopping_sharing_persists_stopped_state_while_keeping_selection() {
        let path = temporary_directory("persist-stop");

        let sharing1 =
            Sharing::with_persistence(FakeCatalog::new(&["HP LaserJet", "Zebra"]), Some(&path));
        sharing1
            .set_shared(vec![name("Zebra")])
            .await
            .expect("selects Zebra");
        sharing1.set_sharing_enabled(true).expect("enables sharing");
        sharing1
            .set_sharing_enabled(false)
            .expect("disables sharing");

        let sharing2 =
            Sharing::with_persistence(FakeCatalog::new(&["HP LaserJet", "Zebra"]), Some(&path));
        assert_eq!(sharing2.shared_printers(), vec![name("Zebra")]);
        assert!(!sharing2.is_autostart_enabled());

        let local = sharing2.local_printers().await.expect("local printers");
        let zebra = local
            .iter()
            .find(|p| p.name().as_str() == "Zebra")
            .expect("zebra");
        assert!(zebra.shared());

        std::fs::remove_dir_all(&path).ok();
    }

    #[tokio::test]
    async fn restore_filters_out_removed_printers_and_still_autostarts_if_any_remain() {
        let path = temporary_directory("restore-filter");

        let sharing1 =
            Sharing::with_persistence(FakeCatalog::new(&["HP LaserJet", "Zebra"]), Some(&path));
        sharing1
            .set_shared(vec![name("HP LaserJet"), name("Zebra")])
            .await
            .expect("selects both");
        sharing1.set_sharing_enabled(true).expect("enables");

        // Zebra was removed while ShaPrint was closed
        let sharing2 = Sharing::with_persistence(FakeCatalog::new(&["HP LaserJet"]), Some(&path));
        sharing2.restore().await.expect("restores and filters");

        assert_eq!(sharing2.shared_printers(), vec![name("HP LaserJet")]);
        assert!(sharing2.is_autostart_enabled());

        std::fs::remove_dir_all(&path).ok();
    }

    #[tokio::test]
    async fn restore_leaves_sharing_stopped_cleanly_if_all_saved_printers_removed() {
        let path = temporary_directory("restore-empty");

        let sharing1 = Sharing::with_persistence(FakeCatalog::new(&["Zebra"]), Some(&path));
        sharing1
            .set_shared(vec![name("Zebra")])
            .await
            .expect("selects Zebra");
        sharing1.set_sharing_enabled(true).expect("enables");

        // All saved printers removed while ShaPrint was closed
        let sharing2 = Sharing::with_persistence(FakeCatalog::new(&["Canon"]), Some(&path));
        sharing2.restore().await.expect("restores and filters");

        assert!(sharing2.shared_printers().is_empty());
        assert!(!sharing2.is_autostart_enabled());

        std::fs::remove_dir_all(&path).ok();
    }

    struct FakeSpooler {
        records: Vec<crate::domain::SpoolerRecord>,
    }

    #[async_trait]
    impl crate::application::SpoolerReader for FakeSpooler {
        async fn read_spooler_records(
            &self,
        ) -> Result<Vec<crate::domain::SpoolerRecord>, AppError> {
            Ok(self.records.clone())
        }
    }

    #[tokio::test]
    async fn destination_aware_sharing_excludes_client_queues_and_ambiguous_records() {
        use crate::application::DestinationAwarePrinterCatalog;
        use crate::domain::SpoolerRecord;

        let spooler = Arc::new(FakeSpooler {
            records: vec![
                SpoolerRecord::new("Brother HL-L2350DW", "USB001"),
                // Lookalike queue on a local USB port remains selectable (name alone does not qualify)
                SpoolerRecord::new("Office Printer (ShaPrint 10.0.0.5-8631)", "USB002"),
                // Genuine client queue on IPP loopback port
                SpoolerRecord::new(
                    "Office Laser (ShaPrint 10.0.0.5-8631)",
                    "ipp://127.0.0.1:8632/ipp/print/10.0.0.5%3A8631/Office%20Laser",
                ),
                // Genuine client queue on Windows-normalised HTTP loopback port
                SpoolerRecord::new(
                    "Canon (ShaPrint 10.0.0.5-8631)",
                    "http://127.0.0.1:8632/ipp/print/10.0.0.5%3A8631/Canon",
                ),
                // Ambiguous destination
                SpoolerRecord::new(
                    "Corrupt Queue (ShaPrint 10.0.0.5-8631)",
                    "ipp://127.0.0.1:8632/ipp/print/malformed",
                ),
                // Ambiguous name mismatch
                SpoolerRecord::new(
                    "Wrong Queue Name",
                    "ipp://127.0.0.1:8632/ipp/print/10.0.0.5%3A8631/Canon",
                ),
            ],
        });

        let catalog = Arc::new(DestinationAwarePrinterCatalog::new(spooler));
        let sharing = Sharing::new(Arc::clone(&catalog) as Arc<dyn LocalPrinterCatalog>);

        let local = sharing.local_printers().await.expect("reads local queues");
        let local_names: Vec<&str> = local.iter().map(|p| p.name().as_str()).collect();

        // Only real local queues (including lookalikes with real ports) are eligible
        assert_eq!(
            local_names,
            vec![
                "Brother HL-L2350DW",
                "Office Printer (ShaPrint 10.0.0.5-8631)"
            ]
        );

        // Direct selection of a native client queue is rejected by backend
        let err_ipp = sharing
            .set_shared(vec![name("Office Laser (ShaPrint 10.0.0.5-8631)")])
            .await
            .expect_err("must reject client queue");
        assert_eq!(err_ipp.code(), ErrorCode::InvalidInput);

        // Direct selection of an HTTP-normalized client queue is rejected
        let err_http = sharing
            .set_shared(vec![name("Canon (ShaPrint 10.0.0.5-8631)")])
            .await
            .expect_err("must reject client queue");
        assert_eq!(err_http.code(), ErrorCode::InvalidInput);

        // Direct selection of ambiguous queues is rejected
        let err_ambig = sharing
            .set_shared(vec![name("Corrupt Queue (ShaPrint 10.0.0.5-8631)")])
            .await
            .expect_err("must reject ambiguous queue");
        assert_eq!(err_ambig.code(), ErrorCode::InvalidInput);

        // Eligible printers succeed
        sharing
            .set_shared(vec![
                name("Brother HL-L2350DW"),
                name("Office Printer (ShaPrint 10.0.0.5-8631)"),
            ])
            .await
            .expect("eligible printers succeed");
        assert_eq!(sharing.shared_printers().len(), 2);

        // Recognised client queues listing enumerates exactly genuine client queues
        let client_queues = catalog
            .recognised_client_queues()
            .await
            .expect("lists client queues");
        assert_eq!(client_queues.len(), 2);
        assert_eq!(
            client_queues[0].queue_name().as_str(),
            "Canon (ShaPrint 10.0.0.5-8631)"
        );
        assert_eq!(client_queues[0].server_address(), "10.0.0.5:8631");
        assert_eq!(client_queues[0].printer_name().as_str(), "Canon");

        assert_eq!(
            client_queues[1].queue_name().as_str(),
            "Office Laser (ShaPrint 10.0.0.5-8631)"
        );
        assert_eq!(client_queues[1].server_address(), "10.0.0.5:8631");
        assert_eq!(client_queues[1].printer_name().as_str(), "Office Laser");
    }

    #[tokio::test]
    async fn restore_filters_out_saved_client_queues_and_ambiguous_records() {
        use crate::application::DestinationAwarePrinterCatalog;
        use crate::domain::SpoolerRecord;

        let path = temporary_directory("restore-client-queue");

        let spooler = Arc::new(FakeSpooler {
            records: vec![
                SpoolerRecord::new("Brother HL-L2350DW", "USB001"),
                SpoolerRecord::new(
                    "Office Laser (ShaPrint 10.0.0.5-8631)",
                    "ipp://127.0.0.1:8632/ipp/print/10.0.0.5%3A8631/Office%20Laser",
                ),
            ],
        });

        // Craft a saved settings file that contains both a local printer and an injected client queue
        let saved_json = r#"{
            "enabled": true,
            "printers": [
                "Brother HL-L2350DW",
                "Office Laser (ShaPrint 10.0.0.5-8631)"
            ]
        }"#;
        std::fs::write(path.join("sharing_state.json"), saved_json).expect("writes state");

        let catalog = Arc::new(DestinationAwarePrinterCatalog::new(spooler));
        let sharing = Sharing::with_persistence(catalog, Some(&path));

        sharing.restore().await.expect("restore succeeds");

        // The client queue was filtered out; only the real local printer was restored
        assert_eq!(sharing.shared_printers(), vec![name("Brother HL-L2350DW")]);
        assert!(sharing.is_autostart_enabled());

        std::fs::remove_dir_all(&path).ok();
    }

    #[tokio::test]
    async fn restore_preserves_selection_and_enabled_when_catalog_returns_empty() {
        let path = temporary_directory("restore-empty-catalog");
        let saved_json = r#"{
            "enabled": true,
            "printers": [
                "Brother HL-L2350DW"
            ]
        }"#;
        std::fs::write(path.join("sharing_state.json"), saved_json).expect("writes state");

        let catalog = FakeCatalog::new(&[]);
        let sharing = Sharing::with_persistence(catalog, Some(&path));

        sharing.restore().await.expect("restore succeeds");

        // The selection and enabled state must be preserved even if spooler reported no queues
        assert_eq!(sharing.shared_printers(), vec![name("Brother HL-L2350DW")]);
        assert!(sharing.is_autostart_enabled());

        std::fs::remove_dir_all(&path).ok();
    }
}
