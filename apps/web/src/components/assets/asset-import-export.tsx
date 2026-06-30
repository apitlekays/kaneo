import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { exportAssets, importAssets } from "@/fetchers/asset-registry";
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
      toast.success(
        `Imported ${r.imported}${r.failed ? `, ${r.failed} failed` : ""}`,
      );
      setOpen(false);
      setRows([]);
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
    setOpen(true);
  };

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
          <div className="px-6 pb-2 text-sm text-muted-foreground">
            {rows.length} row{rows.length === 1 ? "" : "s"} ready. New serial
            numbers are auto-generated. Recognised columns: name (required),
            category, status, manufacturer, model, registrationNumber, location,
            purchaseDate, purchaseCost, currency, vendor, notes.
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
