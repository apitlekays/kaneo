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
      setErrorMessage(null);
      onImported?.();
    },
    // The import is all-or-nothing — unlike asset-registry's import, there
    // is no "N imported, M failed" outcome. On a 400, nothing was written,
    // so keep the preview open with the row-numbered message visible rather
    // than closing as if something had landed.
    onError: (e) => {
      const message = e instanceof Error ? e.message : "Import failed";
      setErrorMessage(message);
      toast.error(message);
    },
  });

  const onFile = async (file: File) => {
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
    setErrorMessage(null);
    setOpen(true);
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
          if (!next) setErrorMessage(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Meeting Minutes items</DialogTitle>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto px-6 pb-2">
            <p className="text-muted-foreground text-sm">
              {rows.length} row{rows.length === 1 ? "" : "s"} ready. This import
              is all-or-nothing — if any row fails, nothing is created.
            </p>
            {errorMessage && (
              <p
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-destructive text-sm"
              >
                {errorMessage}
              </p>
            )}
            <div className="space-y-1.5">
              {rows.map((row) => (
                <div
                  // Rows have no stable id before import (that's assigned on
                  // creation), so the key is the row's own content rather
                  // than its array position — this is a static preview
                  // rendered once per file selection, never reordered.
                  key={`${row.numbering ?? ""}-${row.topic ?? ""}-${row.details ?? ""}-${row.status ?? ""}-${row.action ?? ""}`}
                  className="flex items-start justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {row.numbering && (
                        <span className="text-muted-foreground">
                          {row.numbering}{" "}
                        </span>
                      )}
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
