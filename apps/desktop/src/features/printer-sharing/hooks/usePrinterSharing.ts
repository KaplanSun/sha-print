import { useCallback, useEffect, useState } from "react";

import {
  addCustomMedia,
  getServerIdentity,
  listCustomMedia,
  listLocalPrinters,
  removeCustomMedia,
  setSharedPrinters,
} from "@/api/ipc";
import {
  toAppError,
  type AppError,
  type CustomMedia,
  type LocalPrinter,
  type ServerIdentity,
} from "@/api/types";

/** What the sharing panel needs to render and change the server's shared printers. */
export interface PrinterSharingController {
  /** Local queues and their sharing state, or `null` until the first response arrives. */
  printers: LocalPrinter[] | null;
  /** The identity clients approve and the port they connect to. */
  identity: ServerIdentity | null;
  /** User-configured custom paper sizes advertised to clients. */
  customMedia: CustomMedia[] | null;
  /** Whether a custom media change is in flight. */
  customMediaBusy: boolean;
  /** Queue whose sharing state is being changed, if any. */
  busy: string | null;
  /** Most recent failure worth showing the user. */
  error: AppError | null;
  toggle: (name: string) => Promise<void>;
  refresh: () => Promise<void>;
  dismissError: () => void;
  addCustomMedia: (media: CustomMedia) => Promise<void>;
  removeCustomMedia: (label: string) => Promise<void>;
}

/**
 * Keeps the sharing panel in sync with the shell: it lists the local queues, the custom paper
 * sizes, and the server identity, and every change returns the state the shell actually applied. A
 * rejected change re-reads the queues, so a checkbox never shows a state the server is not in —
 * and keeps the failure visible while it does.
 */
export function usePrinterSharing(): PrinterSharingController {
  const [printers, setPrinters] = useState<LocalPrinter[] | null>(null);
  const [identity, setIdentity] = useState<ServerIdentity | null>(null);
  const [customMedia, setCustomMedia] = useState<CustomMedia[] | null>(null);
  const [customMediaBusy, setCustomMediaBusy] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  const load = useCallback(async () => {
    try {
      const [listing, serverIdentity, media] = await Promise.all([
        listLocalPrinters(),
        getServerIdentity(),
        listCustomMedia(),
      ]);
      setPrinters(listing.printers);
      setIdentity(serverIdentity);
      setCustomMedia(media.media);
    } catch (cause) {
      setError(toAppError(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    async (name: string) => {
      setBusy(name);
      setError(null);
      try {
        const next = (printers ?? [])
          .filter((printer) => (printer.name === name ? !printer.shared : printer.shared))
          .map((printer) => printer.name);
        const updated = await setSharedPrinters(next);
        setPrinters(updated.printers);
      } catch (cause) {
        setError(toAppError(cause));
        await load();
      } finally {
        setBusy(null);
      }
    },
    [load, printers],
  );

  const addCustomMediaCb = useCallback(
    async (media: CustomMedia) => {
      setCustomMediaBusy(true);
      setError(null);
      try {
        const updated = await addCustomMedia(media);
        setCustomMedia(updated.media);
      } catch (cause) {
        setError(toAppError(cause));
        await load();
      } finally {
        setCustomMediaBusy(false);
      }
    },
    [load],
  );

  const removeCustomMediaCb = useCallback(
    async (label: string) => {
      setCustomMediaBusy(true);
      setError(null);
      try {
        const updated = await removeCustomMedia(label);
        setCustomMedia(updated.media);
      } catch (cause) {
        setError(toAppError(cause));
        await load();
      } finally {
        setCustomMediaBusy(false);
      }
    },
    [load],
  );

  const dismissError = useCallback(() => {
    setError(null);
  }, []);

  return {
    printers,
    identity,
    customMedia,
    customMediaBusy,
    busy,
    error,
    toggle,
    refresh: load,
    dismissError,
    addCustomMedia: addCustomMediaCb,
    removeCustomMedia: removeCustomMediaCb,
  };
}
