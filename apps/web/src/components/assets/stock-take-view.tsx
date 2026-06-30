import { Plus, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useAuditSession,
  useAuditSessions,
  useStockTakeMutations,
} from "@/hooks/queries/asset-registry/use-stock-take";
import { cn } from "@/lib/cn";
import { formatDateMedium } from "@/lib/format";
import { toast } from "@/lib/toast";

export function StockTakeView({ workspaceId }: { workspaceId: string }) {
  const { data: sessions = [] } = useAuditSessions(workspaceId);
  const m = useStockTakeMutations(workspaceId);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  if (activeId) {
    return (
      <ActiveSession
        workspaceId={workspaceId}
        sessionId={activeId}
        onBack={() => setActiveId(null)}
      />
    );
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Stock-take</h2>
        <p className="text-sm text-muted-foreground">
          Scan asset barcodes/QR (serial) to reconcile against the registry.
        </p>
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="Session name (e.g. Q2 2026 audit)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <Button
          size="sm"
          disabled={!newName.trim() || m.start.isPending}
          onClick={() =>
            m.start.mutate(newName.trim(), {
              onSuccess: (s) => {
                setNewName("");
                setActiveId(s.id);
              },
            })
          }
        >
          <Plus className="h-4 w-4" /> Start
        </Button>
      </div>
      <div className="space-y-1.5">
        {sessions.map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
          >
            <button
              type="button"
              onClick={() => setActiveId(s.id)}
              className="text-left"
            >
              <div className="font-medium">{s.name}</div>
              <div className="text-xs text-muted-foreground">
                {formatDateMedium(s.startedAt)}
                {s.closedAt ? " · closed" : " · open"}
              </div>
            </button>
            <button
              type="button"
              onClick={() => m.remove.mutate(s.id)}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {sessions.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No stock-take sessions yet.
          </p>
        )}
      </div>
    </div>
  );
}

function ActiveSession({
  workspaceId,
  sessionId,
  onBack,
}: {
  workspaceId: string;
  sessionId: string;
  onBack: () => void;
}) {
  const { data } = useAuditSession(workspaceId, sessionId);
  const m = useStockTakeMutations(workspaceId, sessionId);
  const [serial, setSerial] = useState("");

  const submitScan = () => {
    const value = serial.trim();
    if (!value) return;
    m.scan.mutate(value, {
      onSuccess: (r) => {
        if (!r.found) toast.error(`Unknown serial: ${value}`);
        setSerial("");
      },
    });
  };

  const found = data?.scans.filter((s) => s.status === "found") ?? [];
  const unexpected = data?.scans.filter((s) => s.status === "unexpected") ?? [];
  const missing = data?.missing ?? [];
  const closed = Boolean(data?.session.closedAt);

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Sessions
        </button>
        {!closed && (
          <Button variant="outline" size="sm" onClick={() => m.close.mutate()}>
            Close session
          </Button>
        )}
      </div>
      <h2 className="text-lg font-semibold">{data?.session.name}</h2>

      {!closed && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitScan();
          }}
          className="flex gap-2"
        >
          {/* Handheld scanners type the serial then Enter. */}
          {/* biome-ignore lint/a11y/noAutofocus: scan box should grab focus */}
          <Input
            autoFocus
            placeholder="Scan or type serial, then Enter…"
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
            className="font-mono"
          />
          <Button size="sm" type="submit">
            Scan
          </Button>
        </form>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <StockColumn
          title="Found"
          tone="text-emerald-600"
          items={found.map((s) => ({
            id: s.id,
            primary: s.assetName ?? s.scannedSerial,
            secondary: s.scannedSerial,
          }))}
        />
        <StockColumn
          title="Missing"
          tone="text-amber-600"
          items={missing.map((a) => ({
            id: a.id,
            primary: a.name,
            secondary: a.serialNumber,
          }))}
        />
        <StockColumn
          title="Unexpected"
          tone="text-rose-600"
          items={unexpected.map((s) => ({
            id: s.id,
            primary: s.scannedSerial,
            secondary: "Not in registry",
          }))}
        />
      </div>
    </div>
  );
}

function StockColumn({
  title,
  tone,
  items,
}: {
  title: string;
  tone: string;
  items: Array<{ id: string; primary: ReactNode; secondary: ReactNode }>;
}) {
  return (
    <div className="rounded-xl border border-border">
      <div
        className={cn(
          "flex items-center justify-between border-b border-border px-3 py-2 text-xs font-medium",
          tone,
        )}
      >
        <span>{title}</span>
        <span>{items.length}</span>
      </div>
      <ul className="max-h-80 divide-y divide-border overflow-y-auto">
        {items.map((i) => (
          <li key={i.id} className="px-3 py-2 text-sm">
            <div className="truncate">{i.primary}</div>
            <div className="truncate font-mono text-xs text-muted-foreground">
              {i.secondary}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
