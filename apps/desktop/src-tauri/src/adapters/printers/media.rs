//! The media sizes ShaPrint advertises and maps into Windows printer settings.

#[cfg(any(windows, unix, test))]
const DIMENSION_TOLERANCE_TENTHS_MM: i16 = 5;
#[cfg(any(windows, unix, test))]
const CUSTOM_MIN_TENTHS_MM: i16 = 500;
#[cfg(any(windows, unix, test))]
const CUSTOM_MAX_SHORT_TENTHS_MM: i16 = 3302;
#[cfg(any(windows, unix, test))]
const CUSTOM_MAX_LONG_TENTHS_MM: i16 = 4500;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct MediaSpec {
    pub keyword: &'static str,
    pub paper_id: i16,
    pub short_tenths_mm: i16,
    pub long_tenths_mm: i16,
    pub explicit_dimensions: bool,
}

pub(crate) const MEDIA_CATALOG: &[MediaSpec] = &[
    media("iso_a4_210x297mm", 9, 2100, 2970, false),
    media("na_letter_8.5x11in", 1, 2159, 2794, false),
    media("na_legal_8.5x14in", 5, 2159, 3556, false),
    media("om_folio_210x330mm", 14, 2100, 3300, true),
    media("na_foolscap_8.5x13in", 14, 2159, 3302, false),
    media("iso_a3_297x420mm", 8, 2970, 4200, false),
    media("iso_a5_148x210mm", 11, 1480, 2100, false),
    media("iso_a6_105x148mm", 70, 1050, 1480, false),
    media("iso_b4_250x353mm", 12, 2500, 3530, true),
    media("iso_b5_176x250mm", 13, 1760, 2500, true),
    media("jis_b5_182x257mm", 13, 1820, 2570, false),
    media("na_executive_7.25x10.5in", 7, 1842, 2667, false),
    media("na_invoice_5.5x8.5in", 6, 1397, 2159, false),
    media("na_ledger_11x17in", 3, 2794, 4318, false),
    media("oe_photo-4x6_4x6in", 256, 1016, 1524, true),
    media("na_index-4x6_4x6in", 256, 1016, 1524, true),
    media("na_5x7_5x7in", 256, 1270, 1778, true),
    media("iso_dl_110x220mm", 27, 1100, 2200, false),
    media("iso_c5_162x229mm", 28, 1620, 2290, false),
    media("na_number-10_4.125x9.5in", 20, 1048, 2413, false),
    media("na_monarch_3.875x7.5in", 37, 984, 1905, false),
];

const fn media(
    keyword: &'static str,
    paper_id: i16,
    short_tenths_mm: i16,
    long_tenths_mm: i16,
    explicit_dimensions: bool,
) -> MediaSpec {
    MediaSpec {
        keyword,
        paper_id,
        short_tenths_mm,
        long_tenths_mm,
        explicit_dimensions,
    }
}

#[cfg(any(windows, unix, test))]
pub(crate) fn media_spec(value: &str) -> Option<MediaSpec> {
    let canonical = match value {
        "a4" | "A4" | "iso-a4" | "iso_a4" => "iso_a4_210x297mm",
        "letter" | "Letter" | "na-letter" | "na_letter" => "na_letter_8.5x11in",
        "legal" | "Legal" | "na-legal" | "na_legal" => "na_legal_8.5x14in",
        "f4" | "F4" | "folio" | "Folio" => "om_folio_210x330mm",
        "na_tabloid_11x17in" | "tabloid" | "Tabloid" => "na_ledger_11x17in",
        other => other,
    };
    if let Some(spec) = MEDIA_CATALOG
        .iter()
        .find(|candidate| candidate.keyword == canonical)
    {
        return Some(*spec);
    }

    let (short_tenths_mm, long_tenths_mm) = parse_media_dimensions(canonical)?;
    let standard = media_for_dimensions(short_tenths_mm, long_tenths_mm);
    Some(MediaSpec {
        keyword: standard.map_or("custom", |spec| spec.keyword),
        paper_id: standard.map_or(256, |spec| spec.paper_id),
        short_tenths_mm,
        long_tenths_mm,
        explicit_dimensions: standard.is_none_or(|spec| spec.explicit_dimensions),
    })
}

#[cfg(any(windows, unix, test))]
pub(crate) fn media_for_dimensions(short: i16, long: i16) -> Option<MediaSpec> {
    MEDIA_CATALOG.iter().find_map(|spec| {
        ((short - spec.short_tenths_mm).abs() <= DIMENSION_TOLERANCE_TENTHS_MM
            && (long - spec.long_tenths_mm).abs() <= DIMENSION_TOLERANCE_TENTHS_MM)
            .then_some(*spec)
    })
}

#[cfg(any(windows, unix, test))]
pub(crate) fn custom_dimensions_are_supported(short: i16, long: i16) -> bool {
    short >= CUSTOM_MIN_TENTHS_MM
        && long >= CUSTOM_MIN_TENTHS_MM
        && short <= CUSTOM_MAX_SHORT_TENTHS_MM
        && long <= CUSTOM_MAX_LONG_TENTHS_MM
}

/// A media entry the server advertises to clients, carrying an owned keyword so it can represent
/// either a built-in catalog size or a user-configured custom size.
///
/// The built-in catalog uses `&'static str` keywords; a custom size the user configures at runtime
/// needs an owned `String`. This type is the runtime form both share, and it is what the IPPS
/// response builders consume.
#[derive(Debug, Clone)]
pub struct AdvertisedMedia {
    pub keyword: String,
    pub paper_id: i16,
    pub short_tenths_mm: i16,
    pub long_tenths_mm: i16,
    pub explicit_dimensions: bool,
}

impl AdvertisedMedia {
    /// Copies a built-in catalog entry into its runtime form.
    pub(crate) fn from_spec(spec: &MediaSpec) -> Self {
        Self {
            keyword: spec.keyword.to_owned(),
            paper_id: spec.paper_id,
            short_tenths_mm: spec.short_tenths_mm,
            long_tenths_mm: spec.long_tenths_mm,
            explicit_dimensions: spec.explicit_dimensions,
        }
    }

    /// Builds the runtime entry for a user-configured custom size.
    ///
    /// Custom media use `DMPAPER_CUSTOM` (`paper_id` 256) and are advertised with the
    /// `custom_<w>x<h>mm` keyword — the same form `media_spec` already parses — so a client job
    /// submitted with a custom size maps onto the Windows DEVMODE with no extra plumbing.
    pub fn custom(short_tenths_mm: i16, long_tenths_mm: i16) -> Self {
        Self {
            keyword: custom_keyword(short_tenths_mm, long_tenths_mm),
            paper_id: 256,
            short_tenths_mm,
            long_tenths_mm,
            explicit_dimensions: true,
        }
    }
}

/// The IPP keyword used to advertise a custom media size (e.g. `custom_100x150mm`).
pub fn custom_keyword(short_tenths_mm: i16, long_tenths_mm: i16) -> String {
    format!(
        "custom_{}x{}mm",
        short_tenths_mm as f64 / 10.0,
        long_tenths_mm as f64 / 10.0
    )
}

/// Merges the built-in catalog with the user-configured custom sizes, dropping any duplicate that
/// would otherwise collide with a built-in keyword.
#[cfg(any(windows, unix, test))]
pub fn advertised_catalog(custom: &[AdvertisedMedia]) -> Vec<AdvertisedMedia> {
    let mut catalog: Vec<AdvertisedMedia> =
        MEDIA_CATALOG.iter().map(AdvertisedMedia::from_spec).collect();
    for media in custom {
        if !catalog.iter().any(|existing| existing.keyword == media.keyword) {
            catalog.push(media.clone());
        }
    }
    catalog
}

#[cfg(any(windows, unix, test))]
fn parse_media_dimensions(value: &str) -> Option<(i16, i16)> {
    let (dimensions, scale) = if let Some(value) = value.strip_suffix("mm") {
        (value.strip_suffix("_100th-").unwrap_or(value), 10.0)
    } else if let Some(value) = value.strip_suffix("cm") {
        (value, 100.0)
    } else {
        (value.strip_suffix("in")?, 254.0)
    };
    let candidate = dimensions.rsplit('_').next().unwrap_or(dimensions);
    let (width, height) = if let Some((width, height)) = candidate.split_once('x') {
        (
            width.trim_start_matches(|c: char| !c.is_ascii_digit()),
            height,
        )
    } else {
        let index = candidate.find('h')?;
        let (width, height) = candidate.split_at(index);
        (
            width.trim_start_matches(|c: char| !c.is_ascii_digit()),
            &height[1..],
        )
    };
    let width = (width.parse::<f64>().ok()? * scale).round();
    let height = (height.parse::<f64>().ok()? * scale).round();
    if !(1.0..=f64::from(i16::MAX)).contains(&width)
        || !(1.0..=f64::from(i16::MAX)).contains(&height)
    {
        return None;
    }
    let short = (width as i16).min(height as i16);
    let long = (width as i16).max(height as i16);
    custom_dimensions_are_supported(short, long).then_some((short, long))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_advertised_media_has_a_unique_keyword_and_valid_dimensions() {
        for (index, spec) in MEDIA_CATALOG.iter().enumerate() {
            assert!(spec.short_tenths_mm > 0);
            assert!(spec.long_tenths_mm >= spec.short_tenths_mm);
            assert!(!MEDIA_CATALOG[..index]
                .iter()
                .any(|previous| previous.keyword == spec.keyword));
            assert_eq!(media_spec(spec.keyword), Some(*spec));
        }
    }

    #[test]
    fn common_media_aliases_resolve_to_standard_specs() {
        assert_eq!(
            media_spec("A4").map(|s| s.keyword),
            Some("iso_a4_210x297mm")
        );
        assert_eq!(
            media_spec("a4").map(|s| s.keyword),
            Some("iso_a4_210x297mm")
        );
        assert_eq!(
            media_spec("Letter").map(|s| s.keyword),
            Some("na_letter_8.5x11in")
        );
        assert_eq!(
            media_spec("letter").map(|s| s.keyword),
            Some("na_letter_8.5x11in")
        );
        assert_eq!(
            media_spec("Legal").map(|s| s.keyword),
            Some("na_legal_8.5x14in")
        );
        assert_eq!(
            media_spec("legal").map(|s| s.keyword),
            Some("na_legal_8.5x14in")
        );
        assert_eq!(
            media_spec("Folio").map(|s| s.keyword),
            Some("om_folio_210x330mm")
        );
        assert_eq!(
            media_spec("folio").map(|s| s.keyword),
            Some("om_folio_210x330mm")
        );
        assert_eq!(
            media_spec("Tabloid").map(|s| s.keyword),
            Some("na_ledger_11x17in")
        );
    }

    #[test]
    fn legacy_custom_media_is_bounded() {
        assert!(media_spec("custom_min_100x150mm").is_some());
        assert!(media_spec("custom_330.2x450mm").is_some());
        assert!(media_spec("custom_49x150mm").is_none());
        assert!(media_spec("custom_331x450mm").is_none());
        assert!(media_spec("custom_330x451mm").is_none());
    }

    #[test]
    fn custom_keyword_round_trips_through_media_spec() {
        // Dimensions always resolve; sizes that exactly match a built-in (e.g. A4) map to the
        // standard spec, while genuinely custom sizes use `DMPAPER_CUSTOM`.
        for (short, long, paper_id) in [
            (1000, 1500, 256),
            (3302, 4500, 256),
            (500, 500, 256),
            (2100, 2970, 9),
        ] {
            let keyword = custom_keyword(short, long);
            let resolved = media_spec(&keyword).expect("custom keyword resolves");
            assert_eq!(resolved.paper_id, paper_id, "for {keyword}");
            assert_eq!(resolved.short_tenths_mm, short);
            assert_eq!(resolved.long_tenths_mm, long);
        }
    }

    #[test]
    fn advertised_catalog_merges_custom_media_after_builtins_and_dedups() {
        let custom = vec![
            AdvertisedMedia::custom(1000, 1500),
            AdvertisedMedia::custom(3302, 4500),
        ];
        let catalog = advertised_catalog(&custom);
        assert_eq!(catalog.len(), MEDIA_CATALOG.len() + custom.len());
        // Built-ins come first, in catalog order.
        assert_eq!(catalog[0].keyword, MEDIA_CATALOG[0].keyword);
        // Custom entries are appended.
        assert_eq!(catalog.last().unwrap().keyword, "custom_330.2x450mm");
        // A custom entry colliding with a built-in keyword is dropped.
        let duplicate = vec![AdvertisedMedia::from_spec(&MEDIA_CATALOG[0])];
        assert_eq!(
            advertised_catalog(&duplicate).len(),
            MEDIA_CATALOG.len()
        );
    }
}
