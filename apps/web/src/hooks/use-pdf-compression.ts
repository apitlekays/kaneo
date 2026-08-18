import { useCallback, useRef, useState } from "react";
import {
  type CompressionResult,
  compressPdfIfScanned,
  type PdfEngine,
} from "@/lib/compress-pdf";

export type CompressionProgress = { page: number; total: number };

/**
 * Drives PDF compression for an upload dialog: one run at a time, cancellable,
 * with per-page progress. A superseded run is aborted and its late result
 * discarded, so picking a second file can never be overwritten by the first.
 */
export function usePdfCompression() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<CompressionProgress | null>(null);
  const [result, setResult] = useState<CompressionResult | null>(null);
  const currentRun = useRef<AbortController | null>(null);

  const run = useCallback(async (file: File, engine?: PdfEngine) => {
    currentRun.current?.abort();
    const controller = new AbortController();
    currentRun.current = controller;
    const isCurrent = () => currentRun.current === controller;

    setBusy(true);
    setProgress(null);
    setResult(null);

    try {
      const outcome = await compressPdfIfScanned(file, {
        engine,
        signal: controller.signal,
        onProgress: (page, total) => {
          if (isCurrent()) setProgress({ page, total });
        },
      });
      if (isCurrent()) {
        setResult(outcome);
        setBusy(false);
      }
      return outcome;
    } catch (error) {
      if (isCurrent()) setBusy(false);
      throw error;
    }
  }, []);

  const cancel = useCallback(() => {
    currentRun.current?.abort();
  }, []);

  const reset = useCallback(() => {
    currentRun.current?.abort();
    currentRun.current = null;
    setBusy(false);
    setProgress(null);
    setResult(null);
  }, []);

  return { busy, progress, result, run, cancel, reset };
}
