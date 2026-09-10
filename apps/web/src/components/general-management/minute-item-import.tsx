import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  importMinuteItems,
  type MinuteItemImportRow,
  type MinuteItemImportRowError,
} from "@/fetchers/meeting";
import { downloadText, parseCsv, toCsv } from "@/lib/csv";
import { toast } from "@/lib/toast";

const TEMPLATE_COLUMNS = ["numbering", "topic", "details", "status", "action"];

// One illustrative row, not a bare header — a user opening the template
// otherwise has no idea what belongs in each column, especially `action`,
// whose only valid non-empty value is the literal "/".
const TEMPLATE_EXAMPLE_ROW = {
  numbering: "1.1",
  topic: "Approve the annual budget",
  details:
    "The committee reviewed and approved the FY2027 budget as presented.",
  status: "Approved",
  action: "/",
};

/**
 * Mirrors `isActionMarker` in apps/api/src/meeting/minute-item-import.ts:
 * the `action` column is marked with `/` and nothing else. Duplicated here
 * rather than imported — that module is the API's internals, not this
 * app's to reach across for — purely so the preview can show which rows
 * will become follow-up actions before the server ever sees the file.
 */
function isActionMarker(value: string | undefined): boolean {
  return value?.trim() === "/";
}

/**
 * `parseCsv` (untouched, in @/lib/csv.ts) intentionally drops an all-blank
 * line before slicing off the header — routine in a spreadsheet export as a
 * separator or trailing `,,,,` line — while the server numbers a 400's
 * errors as (surviving) array index + 2. Rendering `Row {index + 2}` on
 * every previewed row, rather than trusting the file's own line numbers,
 * keeps the preview and any later error list numbered the same way, even
 * where both diverge from what Excel would call that line.
 */
function previewRowNumber(index: number): number {
  return index + 2;
}

function extractRowErrors(error: unknown): MinuteItemImportRowError[] | null {
  if (
    error &&
    typeof error === "object" &&
    "rowErrors" in error &&
    Array.isArray((error as { rowErrors?: unknown }).rowErrors)
  ) {
    const rowErrors = (error as { rowErrors: unknown[] }).rowErrors;
    if (rowErrors.length > 0) return rowErrors as MinuteItemImportRowError[];
  }
  return null;
}

export function MinuteItemImport({
  workspaceId,
  meetingId,
  onImported,
}: {
  workspaceId: string;
  meetingId: string;
  onImported?: () => void;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<MinuteItemImportRow[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // The one-line `errorMessage` (used for the toast) collapses a 400 to its
  // first issue; when the server attached the full list (see
  // fetchers/meeting/index.ts's `.rowErrors`), render every row's problem
  // here instead of forcing an upload-fix-upload cycle per row.
  const [errorRows, setErrorRows] = useState<MinuteItemImportRowError[] | null>(
    null,
  );

  const resetError = () => {
    setErrorMessage(null);
    setErrorRows(null);
  };

  const downloadTemplate = () => {
    downloadText(
      "meeting-minute-items-template.csv",
      toCsv([TEMPLATE_EXAMPLE_ROW], TEMPLATE_COLUMNS),
    );
  };

  const importMut = useMutation({
    mutationFn: () => importMinuteItems(workspaceId, meetingId, rows),
    onSuccess: (result) => {
      // Both minute items and actions come back on the same GET /meeting/:id
      // response, so one invalidation refreshes both tabs.
      qc.invalidateQueries({ queryKey: ["meeting", workspaceId, meetingId] });
      toast.success(
        `Imported ${result.itemsCreated} Meeting Minutes item${
          result.itemsCreated === 1 ? "" : "s"
        }${
          result.actionsCreated > 0
            ? ` and ${result.actionsCreated} action${
                result.actionsCreated === 1 ? "" : "s"
              }`
            : ""
        }`,
      );
      setOpen(false);
      setRows([]);
      resetError();
      onImported?.();
    },
    // The import is all-or-nothing — unlike asset-registry's import, there
    // is no "N imported, M failed" outcome. On a 400, nothing was written,
    // so keep the preview open with the row-numbered message(s) visible
    // rather than closing as if something had landed.
    onError: (e) => {
      const message = e instanceof Error ? e.message : "Import failed";
      setErrorMessage(message);
      setErrorRows(extractRowErrors(e));
      toast.error(message);
    },
  });

  const onFile = async (file: File) => {
    // Caught here, not left as a floating rejection at the call site: a
    // `file.text()` failure (unreadable/corrupt file, permission denial)
    // must surface the same way a 400 does — inline, in the dialog — rather
    // than as an unhandled promise rejection with nothing visible on screen.
    try {
      const parsed = parseCsv(await file.text());
      const mapped: MinuteItemImportRow[] = parsed.map((r) => {
        const lc: Record<string, string> = {};
        for (const k of Object.keys(r)) lc[k.toLowerCase()] = r[k];
        const g = (k: string) => lc[k] || undefined;
        return {
          numbering: g("numbering"),
          topic: g("topic"),
          details: g("details"),
          status: g("status"),
          action: g("action"),
        };
      });
      setRows(mapped);
      resetError();
      setOpen(true);
    } catch (err) {
      setRows([]);
      setErrorMessage(
        err instanceof Error ? err.message : "Couldn't read that file",
      );
      setErrorRows(null);
      setOpen(true);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <Button variant="outline" size="sm" onClick={downloadTemplate}>
        <Download className="h-3.5 w-3.5" /> Download template
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          // onFile catches its own rejections internally (see its own
          // comment) and always resolves, so there's nothing left to
          // attach a `.catch` to here.
          if (f) onFile(f);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="h-3.5 w-3.5" /> Import Meeting Minutes items
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) resetError();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Meeting Minutes items</DialogTitle>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto px-6 pb-2">
            <p className="text-muted-foreground text-sm">
              {rows.length} row{rows.length === 1 ? "" : "s"} ready. This import
              is all-or-nothing — if any row fails, nothing is created. Blank
              lines are ignored; the row numbers below refer only to the rows
              listed here.
            </p>
            {(errorRows || errorMessage) && (
              <div
                role="alert"
                className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-destructive text-sm"
              >
                {errorRows ? (
                  <ul className="list-disc space-y-0.5 pl-4">
                    {errorRows.map((rowError) => (
                      <li key={rowError.row}>
                        Row {rowError.row}: {rowError.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{errorMessage}</p>
                )}
              </div>
            )}
            <div className="space-y-1.5">
              {rows.map((row, index) => (
                <div
                  // Rows have no stable id before import (that's assigned on
                  // creation), and two byte-identical rows (e.g. two
                  // blank-numbered rows with the same topic — the validator
                  // explicitly accepts this) would collide on a
                  // content-derived key. This is a static preview rendered
                  // once per file selection, never reordered, so the index
                  // is safe here.
                  key={`minute-item-import-row-${
                    // biome-ignore lint/suspicious/noArrayIndexKey: static preview list, never reordered
                    index
                  }`}
                  data-testid="minute-item-import-row"
                  className="flex items-start justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      <span className="text-muted-foreground">
                        Row {previewRowNumber(index)}
                        {row.numbering ? ` · ${row.numbering}` : ""}{" "}
                      </span>
                      {row.topic || (
                        <span className="text-destructive">Missing topic</span>
                      )}
                    </div>
                    {row.status && (
                      <div className="text-muted-foreground text-xs">
                        {row.status}
                      </div>
                    )}
                  </div>
                  {isActionMarker(row.action) && (
                    <Badge variant="outline" className="shrink-0 text-xs">
                      Action
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!rows.length || importMut.isPending}
              onClick={() => importMut.mutate()}
            >
              Import {rows.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
