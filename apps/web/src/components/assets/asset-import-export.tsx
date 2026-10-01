import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  exportAssets,
  type ImportResult,
  importAssets,
} from "@/fetchers/asset-registry";
import { downloadText, parseCsv, toCsv } from "@/lib/csv";
import { toast } from "@/lib/toast";

const EXPORT_COLUMNS = [
  "serialNumber",
  "assetTag",
  "name",
  "category",
  "status",
  "manufacturer",
  "model",
  "registrationNumber",
  "location",
  "custodian",
  "purchaseDate",
  "purchaseCost",
  "currency",
  "netBookValue",
  "vendor",
  "nextRenewal",
  "notes",
];

export function AssetImportExport({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  // What the server says will happen, before anything is written.
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const exportCsv = async () => {
    try {
      const data = await exportAssets(workspaceId);
      downloadText(
        `assets-${new Date().toISOString().slice(0, 10)}.csv`,
        toCsv(data, EXPORT_COLUMNS),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    }
  };

  const importMut = useMutation({
    mutationFn: () => importAssets(workspaceId, rows),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["assets", workspaceId] });
      qc.invalidateQueries({ queryKey: ["asset-summary", workspaceId] });
      const parts = [`Imported ${r.imported}`];
      if (r.skipped.length) parts.push(`${r.skipped.length} skipped`);
      if (r.failed) parts.push(`${r.failed} failed`);
      toast.success(parts.join(", "));
      setOpen(false);
      setRows([]);
      setPreview(null);
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Import failed"),
  });

  const onFile = async (file: File) => {
    const parsed = parseCsv(await file.text());
    const num = (v: string) => {
      const n = v ? Number(v) : Number.NaN;
      return Number.isFinite(n) ? n : null;
    };
    const mapped = parsed
      .map((r) => {
        const lc: Record<string, string> = {};
        for (const k of Object.keys(r)) lc[k.toLowerCase()] = r[k];
        const g = (k: string) => lc[k] ?? "";
        return {
          name: g("name"),
          category: g("category") || null,
          status: g("status") || null,
          manufacturer: g("manufacturer") || null,
          model: g("model") || null,
          registrationNumber:
            g("registrationnumber") || g("registration") || null,
          location: g("location") || null,
          purchaseDate: g("purchasedate") || null,
          purchaseCost: num(g("purchasecost")),
          currency: g("currency") || null,
          vendor: g("vendor") || null,
          notes: g("notes") || null,
        };
      })
      .filter((m) => m.name.trim());
    setRows(mapped);
    setPreview(null);
    setOpen(true);
    if (mapped.length === 0) return;
    setPreviewing(true);
    try {
      setPreview(await importAssets(workspaceId, mapped, { dryRun: true }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not check the file");
    } finally {
      setPreviewing(false);
    }
  };

  const willImport = preview?.imported ?? 0;

  return (
    <div className="flex items-center gap-1.5">
      <Button variant="outline" size="sm" onClick={exportCsv}>
        <Download className="h-3.5 w-3.5" /> Export
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
        <Upload className="h-3.5 w-3.5" /> Import
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Import assets</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 px-6 pb-2 text-sm">
            {previewing ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking{" "}
                {rows.length} row{rows.length === 1 ? "" : "s"} against the
                register…
              </p>
            ) : preview ? (
              <>
                <p>
                  <strong>{willImport}</strong> new asset
                  {willImport === 1 ? "" : "s"} will be imported.
                  {preview.skipped.length > 0 && (
                    <>
                      {" "}
                      <strong>{preview.skipped.length}</strong> will be skipped
                      to avoid duplicates.
                    </>
                  )}
                </p>
                {preview.skipped.length > 0 && (
                  <div className="max-h-48 overflow-y-auto rounded-md border border-border">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-muted/60 text-left text-muted-foreground">
                        <tr>
                          <th className="px-2 py-1 font-medium">Row</th>
                          <th className="px-2 py-1 font-medium">Name</th>
                          <th className="px-2 py-1 font-medium">Why skipped</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.skipped.map((skip) => (
                          <tr key={skip.row} className="border-t border-border">
                            <td className="px-2 py-1 text-muted-foreground">
                              {skip.row}
                            </td>
                            <td className="px-2 py-1">{skip.name}</td>
                            <td className="px-2 py-1 text-muted-foreground">
                              {skip.reason === "exists"
                                ? "Already registered"
                                : "Repeats an earlier row"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">
                {rows.length} row{rows.length === 1 ? "" : "s"} ready.
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              Assets whose name is already registered (ignoring capitals and
              spacing) are skipped. New serial numbers are auto-generated.
              Recognised columns: name (required), category, status,
              manufacturer, model, registrationNumber, location, purchaseDate,
              purchaseCost, currency, vendor, notes.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                previewing ||
                importMut.isPending ||
                (preview ? willImport === 0 : !rows.length)
              }
              onClick={() => importMut.mutate()}
            >
              Import {preview ? willImport : rows.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
