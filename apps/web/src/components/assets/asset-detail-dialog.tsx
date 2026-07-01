import { saveAs } from "file-saver";
import {
  Download,
  FileText,
  ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Printer,
  Trash2,
  Upload,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { AssetBarcode } from "@/components/assets/asset-barcode";
import { DateField } from "@/components/assets/date-field";
import { MemberPicker } from "@/components/assets/member-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ColoredAvatar } from "@/components/ui/colored-avatar";
import { useConfirm } from "@/components/ui/confirm";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { AssetDetail } from "@/fetchers/asset-registry";
import { assetFileUrl } from "@/fetchers/asset-registry";
import { useAsset } from "@/hooks/queries/asset-registry/use-asset";
import { useAssetMutations } from "@/hooks/queries/asset-registry/use-asset-mutations";
import {
  buildLocationPaths,
  useLocations,
} from "@/hooks/queries/asset-registry/use-locations";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import {
  ASSET_CATEGORIES,
  ASSET_STATUSES,
  COST_CATEGORIES,
  labelOf,
  RENEWAL_TYPES,
  STATUS_TONES,
} from "@/lib/asset-constants";
import { cn } from "@/lib/cn";
import { formatDateMedium, formatDateTime } from "@/lib/format";
import {
  formatMoney,
  fromMinorUnits,
  toMinorUnits,
} from "@/lib/format-currency";
import { AssetFormDialog } from "./asset-form-dialog";

type Mutations = ReturnType<typeof useAssetMutations>;

export function AssetDetailDialog({
  workspaceId,
  assetId,
  onClose,
}: {
  workspaceId: string;
  assetId: string | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useAsset(workspaceId, assetId);
  const m = useAssetMutations(workspaceId, assetId ?? undefined);
  const [tab, setTab] = useState("overview");

  return (
    <Dialog
      open={Boolean(assetId)}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setTab("overview");
        }
      }}
    >
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden">
        {isLoading || !data ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <DetailBody
            data={data}
            m={m}
            workspaceId={workspaceId}
            tab={tab}
            setTab={setTab}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailBody({
  data,
  m,
  workspaceId,
  tab,
  setTab,
  onClose,
}: {
  data: AssetDetail;
  m: Mutations;
  workspaceId: string;
  tab: string;
  setTab: (v: string) => void;
  onClose: () => void;
}) {
  const { asset } = data;
  const confirm = useConfirm();
  const currency = asset.currency || "MYR";
  const currentCustody = data.custody.find((entry) => !entry.releasedAt);
  const { data: locations = [] } = useLocations(workspaceId);
  const locationName = asset.locationId
    ? (buildLocationPaths(locations).get(asset.locationId) ?? null)
    : asset.location;

  return (
    <>
      <DialogHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 pr-6">
          <div className="min-w-0">
            <DialogTitle className="truncate">{asset.name}</DialogTitle>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{asset.serialNumber}</span>
              <Badge className={cn("border", STATUS_TONES[asset.status])}>
                {labelOf(ASSET_STATUSES, asset.status)}
              </Badge>
              <span>{labelOf(ASSET_CATEGORIES, asset.category)}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <AssetFormDialog
              workspaceId={workspaceId}
              asset={asset}
              trigger={
                <Button variant="outline" size="sm">
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
              }
            />
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              onClick={async () => {
                if (
                  await confirm({
                    title: "Delete asset?",
                    description: `This permanently deletes "${asset.name}" and all its records. This cannot be undone.`,
                  })
                ) {
                  m.remove.mutate(asset.id, { onSuccess: onClose });
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </DialogHeader>

      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="mx-6 flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="financials">Financials</TabsTrigger>
          <TabsTrigger value="files">Files ({data.files.length})</TabsTrigger>
          <TabsTrigger value="renewals">
            Renewals ({data.renewals.length})
          </TabsTrigger>
          <TabsTrigger value="maintenance">
            Maintenance ({data.maintenance.length})
          </TabsTrigger>
          <TabsTrigger value="costs">Costs ({data.costs.length})</TabsTrigger>
          <TabsTrigger value="trips">Trips ({data.trips.length})</TabsTrigger>
          <TabsTrigger value="fleet">Fleet</TabsTrigger>
          <TabsTrigger value="custody">Custody</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="label">Label</TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-3 pb-6">
          <TabsContent value="overview">
            <OverviewTab
              data={data}
              currency={currency}
              custodianName={currentCustody?.userName ?? null}
              locationName={locationName}
            />
          </TabsContent>
          <TabsContent value="financials">
            <FinancialsTab data={data} m={m} currency={currency} />
          </TabsContent>
          <TabsContent value="files">
            <FilesTab data={data} m={m} />
          </TabsContent>
          <TabsContent value="renewals">
            <RenewalsTab data={data} m={m} currency={currency} />
          </TabsContent>
          <TabsContent value="maintenance">
            <MaintenanceTab data={data} m={m} currency={currency} />
          </TabsContent>
          <TabsContent value="costs">
            <CostsTab data={data} m={m} currency={currency} />
          </TabsContent>
          <TabsContent value="trips">
            <TripsTab
              data={data}
              m={m}
              currency={currency}
              workspaceId={workspaceId}
            />
          </TabsContent>
          <TabsContent value="fleet">
            <FleetTab
              data={data}
              m={m}
              currency={currency}
              workspaceId={workspaceId}
            />
          </TabsContent>
          <TabsContent value="custody">
            <CustodyTab data={data} m={m} workspaceId={workspaceId} />
          </TabsContent>
          <TabsContent value="history">
            <HistoryTab data={data} />
          </TabsContent>
          <TabsContent value="label">
            <LabelTab asset={asset} />
          </TabsContent>
        </div>
      </Tabs>
    </>
  );
}

/** Rasterize an in-DOM <svg> to a loaded <img> at its rendered size. */
function rasterizeSvg(svg: SVGSVGElement): Promise<HTMLImageElement> {
  const rect = svg.getBoundingClientRect();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(rect.width));
  clone.setAttribute("height", String(rect.height));
  const xml = new XMLSerializer().serializeToString(clone);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  const img = new Image(rect.width, rect.height);
  return new Promise((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function LabelTab({ asset }: { asset: AssetDetail["asset"] }) {
  const labelRef = useRef<HTMLDivElement>(null);

  const downloadPng = async () => {
    const container = labelRef.current;
    if (!container) return;
    const svgs = Array.from(container.querySelectorAll("svg"));
    if (!svgs.length) return;

    const imgs = await Promise.all(svgs.map(rasterizeSvg));
    const captions = ["Code 128", "Scan for asset details"];
    const scale = 3; // crisp for print
    const pad = 24;
    const gap = 40;
    const captionH = 22;
    const maxH = Math.max(...imgs.map((i) => i.height));
    const contentW =
      imgs.reduce((sum, i) => sum + i.width, 0) + gap * (imgs.length - 1);
    const boardW = contentW + pad * 2;
    const boardH = maxH + captionH + pad * 2;

    const canvas = document.createElement("canvas");
    canvas.width = boardW * scale;
    canvas.height = boardH * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(scale, scale);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, boardW, boardH);

    const baseline = pad + maxH; // bottom-align the two codes
    let x = pad;
    imgs.forEach((img, idx) => {
      ctx.drawImage(img, x, baseline - img.height, img.width, img.height);
      ctx.fillStyle = "#6b7280";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(captions[idx] ?? "", x + img.width / 2, baseline + 16);
      x += img.width + gap;
    });

    canvas.toBlob((blob) => {
      if (blob) saveAs(blob, `${asset.serialNumber}.png`);
    }, "image/png");
  };

  return (
    <div className="space-y-3 py-2">
      <div ref={labelRef}>
        <AssetBarcode
          serial={asset.serialNumber}
          qrValue={`${window.location.origin}/public-asset/${asset.id}`}
        />
      </div>
      {asset.assetTag && (
        <p className="text-sm text-muted-foreground">
          Asset tag: <span className="font-medium">{asset.assetTag}</span>
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="h-3.5 w-3.5" /> Print
        </Button>
        <Button variant="outline" size="sm" onClick={downloadPng}>
          <Download className="h-3.5 w-3.5" /> Download PNG
        </Button>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm">{value || "—"}</div>
    </div>
  );
}

function OverviewTab({
  data,
  currency,
  custodianName,
  locationName,
}: {
  data: AssetDetail;
  currency: string;
  custodianName: string | null;
  locationName: string | null;
}) {
  const a = data.asset;
  return (
    <div className="grid gap-4 py-2 sm:grid-cols-2">
      <Field
        label="Serial number"
        value={<span className="font-mono">{a.serialNumber}</span>}
      />
      <Field label="Asset tag" value={a.assetTag} />
      <Field label="Manufacturer / Make" value={a.manufacturer} />
      <Field label="Model" value={a.model} />
      <Field label="Registration / Plate" value={a.registrationNumber} />
      <Field label="Location" value={locationName} />
      <Field label="Custodian" value={custodianName} />
      <Field label="Vendor" value={a.vendor} />
      <Field
        label="Purchase date"
        value={a.purchaseDate ? formatDateMedium(a.purchaseDate) : null}
      />
      <Field
        label="Purchase cost"
        value={
          a.purchaseCost != null ? formatMoney(a.purchaseCost, currency) : null
        }
      />
      <div className="sm:col-span-2">
        <Field label="Notes" value={a.notes} />
      </div>
      {a.customFields &&
        Object.entries(a.customFields as Record<string, unknown>).map(
          ([k, val]) => (
            <Field key={k} label={k} value={val != null ? String(val) : null} />
          ),
        )}
    </div>
  );
}

function EntrySection({
  title,
  total,
  children,
  form,
}: {
  title: string;
  total?: ReactNode;
  children: ReactNode;
  form: ReactNode;
}) {
  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">{title}</h4>
        {total}
      </div>
      <div className="space-y-1.5">{children}</div>
      <div className="rounded-lg border border-dashed border-border p-3">
        {form}
      </div>
    </div>
  );
}

function EntryRow({
  primary,
  secondary,
  right,
  onEdit,
  onDelete,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
  right?: ReactNode;
  onEdit?: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="truncate">{primary}</div>
        {secondary && (
          <div className="truncate text-xs text-muted-foreground">
            {secondary}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {right}
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="text-muted-foreground hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function FilesTab({ data, m }: { data: AssetDetail; m: Mutations }) {
  const confirm = useConfirm();
  const inputRef = useRef<HTMLInputElement>(null);
  const images = data.files.filter((f) => f.kind === "image");
  const documents = data.files.filter((f) => f.kind !== "image");

  return (
    <div className="space-y-4 py-2">
      <div>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            for (const file of files) m.uploadFile.mutate(file);
            if (inputRef.current) inputRef.current.value = "";
          }}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={m.uploadFile.isPending}
          onClick={() => inputRef.current?.click()}
        >
          {m.uploadFile.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          Upload images / documents
        </Button>
      </div>

      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {images.map((f) => (
            <div key={f.id} className="group relative">
              <img
                src={assetFileUrl(f.id)}
                alt={f.filename}
                className="h-24 w-full rounded-md border border-border object-cover"
              />
              <button
                type="button"
                onClick={async () => {
                  if (
                    await confirm({
                      title: "Remove file?",
                      description: "This permanently deletes this file.",
                    })
                  ) {
                    m.removeFile.mutate(f.id);
                  }
                }}
                className="absolute right-1 top-1 rounded bg-background/80 p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        {documents.map((f) => (
          <EntryRow
            key={f.id}
            primary={
              <a
                href={assetFileUrl(f.id)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 hover:underline"
              >
                <FileText className="h-3.5 w-3.5" /> {f.filename}
              </a>
            }
            onDelete={async () => {
              if (
                await confirm({
                  title: "Remove file?",
                  description: "This permanently deletes this file.",
                })
              ) {
                m.removeFile.mutate(f.id);
              }
            }}
          />
        ))}
        {data.files.length === 0 && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ImageIcon className="h-4 w-4" /> No files yet.
          </p>
        )}
      </div>
    </div>
  );
}

function RenewalsTab({
  data,
  m,
  currency,
}: {
  data: AssetDetail;
  m: Mutations;
  currency: string;
}) {
  const confirm = useConfirm();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [type, setType] = useState("road-tax");
  const [label, setLabel] = useState("");
  const [due, setDue] = useState<Date | null>(null);
  const [cost, setCost] = useState("");
  const now = Date.now();

  const reset = () => {
    setEditingId(null);
    setType("road-tax");
    setLabel("");
    setDue(null);
    setCost("");
  };

  const startEdit = (r: AssetDetail["renewals"][number]) => {
    setEditingId(r.id);
    setType(r.type);
    setLabel(r.label ?? "");
    setDue(new Date(r.dueDate));
    setCost(r.cost != null ? fromMinorUnits(r.cost) : "");
  };

  const submit = () => {
    if (!due) return;
    const body = {
      type,
      label: label.trim() || null,
      dueDate: due.toISOString(),
      cost: toMinorUnits(cost),
    };
    if (editingId) {
      m.updateRenewal.mutate({ id: editingId, body }, { onSuccess: reset });
    } else {
      m.addRenewal.mutate(body, { onSuccess: reset });
    }
  };

  const pending = editingId
    ? m.updateRenewal.isPending
    : m.addRenewal.isPending;

  return (
    <EntrySection
      title="Renewals & expiry"
      form={
        <div className="grid gap-2 sm:grid-cols-2">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger>
              <SelectValue>{labelOf(RENEWAL_TYPES, type)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {RENEWAL_TYPES.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DateField value={due} onChange={setDue} placeholder="Due date *" />
          <Input
            placeholder="Label (optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Input
            type="number"
            placeholder="Cost"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
          <div className="flex gap-2 sm:col-span-2">
            <Button
              size="sm"
              className="flex-1"
              disabled={!due || pending}
              onClick={submit}
            >
              {editingId ? (
                <>
                  <Pencil className="h-3.5 w-3.5" /> Save changes
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5" /> Add renewal
                </>
              )}
            </Button>
            {editingId && (
              <Button size="sm" variant="outline" onClick={reset}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      }
    >
      {data.renewals.map((r) => {
        const overdue = new Date(r.dueDate).getTime() < now;
        return (
          <EntryRow
            key={r.id}
            primary={r.label || labelOf(RENEWAL_TYPES, r.type)}
            secondary={
              r.cost != null ? formatMoney(r.cost, currency) : undefined
            }
            right={
              <span
                className={cn(
                  "text-xs",
                  overdue
                    ? "font-medium text-rose-500"
                    : "text-muted-foreground",
                )}
              >
                {overdue ? "Overdue · " : ""}
                {formatDateMedium(r.dueDate)}
              </span>
            }
            onEdit={() => startEdit(r)}
            onDelete={async () => {
              if (
                await confirm({
                  title: "Remove renewal?",
                  description: "This permanently deletes this renewal entry.",
                })
              ) {
                m.removeRenewal.mutate(r.id);
              }
            }}
          />
        );
      })}
    </EntrySection>
  );
}

function MaintenanceTab({
  data,
  m,
  currency,
}: {
  data: AssetDetail;
  m: Mutations;
  currency: string;
}) {
  const confirm = useConfirm();
  const [date, setDate] = useState<Date | null>(new Date());
  const [title, setTitle] = useState("");
  const [vendor, setVendor] = useState("");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");

  const add = () => {
    if (!title.trim() || !date) return;
    m.addMaintenance.mutate(
      {
        date: date.toISOString(),
        title: title.trim(),
        vendor: vendor.trim() || null,
        cost: toMinorUnits(cost),
        notes: notes.trim() || null,
      },
      {
        onSuccess: () => {
          setTitle("");
          setVendor("");
          setCost("");
          setNotes("");
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <PmSchedulesSection data={data} m={m} />
      <EntrySection
        title="Maintenance log"
        form={
          <div className="grid gap-2 sm:grid-cols-2">
            <DateField value={date} onChange={setDate} placeholder="Date *" />
            <Input
              placeholder="Title *"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Input
              placeholder="Vendor / Workshop"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
            />
            <Input
              type="number"
              placeholder="Cost"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
            <Textarea
              className="sm:col-span-2"
              rows={2}
              placeholder="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <Button
              size="sm"
              className="sm:col-span-2"
              disabled={!title.trim() || !date || m.addMaintenance.isPending}
              onClick={add}
            >
              <Plus className="h-3.5 w-3.5" /> Add entry
            </Button>
          </div>
        }
      >
        {data.maintenance.map((e) => (
          <EntryRow
            key={e.id}
            primary={e.title}
            secondary={[formatDateMedium(e.date), e.vendor, e.notes]
              .filter(Boolean)
              .join(" · ")}
            right={
              e.cost != null ? (
                <span className="text-xs text-muted-foreground">
                  {formatMoney(e.cost, currency)}
                </span>
              ) : undefined
            }
            onDelete={async () => {
              if (
                await confirm({
                  title: "Remove maintenance record?",
                  description:
                    "This permanently deletes this maintenance record.",
                })
              ) {
                m.removeMaintenance.mutate(e.id);
              }
            }}
          />
        ))}
      </EntrySection>
    </div>
  );
}

function PmSchedulesSection({ data, m }: { data: AssetDetail; m: Mutations }) {
  const confirm = useConfirm();
  const [title, setTitle] = useState("");
  const [intervalValue, setIntervalValue] = useState("6");
  const [intervalType, setIntervalType] = useState("months");
  const [nextDue, setNextDue] = useState<Date | null>(null);
  const [nextMeter, setNextMeter] = useState("");
  const isMeter = intervalType === "km" || intervalType === "hours";
  const now = Date.now();

  const add = () => {
    if (!title.trim()) return;
    if (isMeter ? !nextMeter : !nextDue) return;
    m.addPmSchedule.mutate(
      {
        title: title.trim(),
        intervalType,
        intervalValue: Number(intervalValue) || 1,
        ...(isMeter
          ? { nextDueMeter: Number(nextMeter) }
          : { nextDueDate: nextDue?.toISOString() }),
      },
      {
        onSuccess: () => {
          setTitle("");
          setNextDue(null);
          setNextMeter("");
        },
      },
    );
  };

  return (
    <div className="space-y-3 py-2">
      <h4 className="text-sm font-medium">Preventive maintenance schedules</h4>
      <div className="space-y-1.5">
        {data.pmSchedules.map((s) => {
          const meterBased = s.nextDueMeter != null;
          const overdue =
            !meterBased &&
            s.nextDueDate != null &&
            new Date(s.nextDueDate).getTime() < now;
          return (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate">{s.title}</div>
                <div className="text-xs text-muted-foreground">
                  Every {s.intervalValue} {s.intervalType} · next{" "}
                  {meterBased ? (
                    <span>
                      at {s.nextDueMeter?.toLocaleString()} {s.intervalType}
                    </span>
                  ) : (
                    <span
                      className={cn(overdue && "font-medium text-rose-500")}
                    >
                      {s.nextDueDate ? formatDateMedium(s.nextDueDate) : "—"}
                      {overdue ? " (due)" : ""}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    m.updatePmSchedule.mutate({
                      scheduleId: s.id,
                      body: { markDone: true },
                    })
                  }
                >
                  Mark done
                </Button>
                <button
                  type="button"
                  onClick={async () => {
                    if (
                      await confirm({
                        title: "Remove PM schedule?",
                        description:
                          "This permanently deletes this PM schedule.",
                      })
                    ) {
                      m.removePmSchedule.mutate(s.id);
                    }
                  }}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid gap-2 rounded-lg border border-dashed border-border p-3 sm:grid-cols-2">
        <Input
          placeholder="Title (e.g. Service, oil change) *"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        {isMeter ? (
          <Input
            type="number"
            placeholder={`Next due (${intervalType}) *`}
            value={nextMeter}
            onChange={(e) => setNextMeter(e.target.value)}
          />
        ) : (
          <DateField
            value={nextDue}
            onChange={setNextDue}
            placeholder="First due *"
          />
        )}
        <div className="flex items-center gap-2 sm:col-span-2">
          <span className="text-sm text-muted-foreground">Every</span>
          <Input
            type="number"
            className="w-20"
            value={intervalValue}
            onChange={(e) => setIntervalValue(e.target.value)}
          />
          <Select value={intervalType} onValueChange={setIntervalType}>
            <SelectTrigger className="w-28">
              <SelectValue>{intervalType}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="months">months</SelectItem>
              <SelectItem value="days">days</SelectItem>
              <SelectItem value="km">km</SelectItem>
              <SelectItem value="hours">hours</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="ml-auto"
            disabled={
              !title.trim() ||
              (isMeter ? !nextMeter : !nextDue) ||
              m.addPmSchedule.isPending
            }
            onClick={add}
          >
            <Plus className="h-3.5 w-3.5" /> Add schedule
          </Button>
        </div>
      </div>
    </div>
  );
}

function CostsTab({
  data,
  m,
  currency,
}: {
  data: AssetDetail;
  m: Mutations;
  currency: string;
}) {
  const confirm = useConfirm();
  const [date, setDate] = useState<Date | null>(new Date());
  const [category, setCategory] = useState("maintenance");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const total = data.costs.reduce((acc, c) => acc + (c.amount ?? 0), 0);

  const add = () => {
    const cents = toMinorUnits(amount);
    if (cents == null || !date) return;
    m.addCost.mutate(
      {
        date: date.toISOString(),
        category,
        amount: cents,
        note: note.trim() || null,
      },
      {
        onSuccess: () => {
          setAmount("");
          setNote("");
        },
      },
    );
  };

  return (
    <EntrySection
      title="Cost log"
      total={
        <span className="text-sm text-muted-foreground">
          Total {formatMoney(total, currency)}
        </span>
      }
      form={
        <div className="grid gap-2 sm:grid-cols-2">
          <DateField value={date} onChange={setDate} placeholder="Date *" />
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger>
              <SelectValue>{labelOf(COST_CATEGORIES, category)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {COST_CATEGORIES.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            placeholder="Amount *"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Input
            placeholder="Note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            size="sm"
            className="sm:col-span-2"
            disabled={!amount || !date || m.addCost.isPending}
            onClick={add}
          >
            <Plus className="h-3.5 w-3.5" /> Add cost
          </Button>
        </div>
      }
    >
      {data.costs.map((c) => (
        <EntryRow
          key={c.id}
          primary={labelOf(COST_CATEGORIES, c.category)}
          secondary={[formatDateMedium(c.date), c.note]
            .filter(Boolean)
            .join(" · ")}
          right={
            <span className="text-xs font-medium">
              {formatMoney(c.amount, currency)}
            </span>
          }
          onDelete={async () => {
            if (
              await confirm({
                title: "Remove cost entry?",
                description: "This permanently deletes this cost entry.",
              })
            ) {
              m.removeCost.mutate(c.id);
            }
          }}
        />
      ))}
    </EntrySection>
  );
}

function TripsTab({
  data,
  m,
  currency,
  workspaceId,
}: {
  data: AssetDetail;
  m: Mutations;
  currency: string;
  workspaceId: string;
}) {
  const { data: wsUsers } = useGetActiveWorkspaceUsers(workspaceId);
  const members = (wsUsers?.members ?? []) as Array<{
    userId: string;
    user?: { name?: string | null } | null;
  }>;
  const driverName = (id: string | null) =>
    id ? (members.find((mm) => mm.userId === id)?.user?.name ?? null) : null;

  const confirm = useConfirm();
  const [date, setDate] = useState<Date | null>(new Date());
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [distance, setDistance] = useState("");
  const [driverId, setDriverId] = useState<string | null>(null);
  const [purpose, setPurpose] = useState("");
  const [cost, setCost] = useState("");

  const add = () => {
    if (!date) return;
    m.addTrip.mutate(
      {
        date: date.toISOString(),
        origin: origin.trim() || null,
        destination: destination.trim() || null,
        distanceKm: distance ? Number(distance) : null,
        driverId,
        purpose: purpose.trim() || null,
        cost: toMinorUnits(cost),
      },
      {
        onSuccess: () => {
          setOrigin("");
          setDestination("");
          setDistance("");
          setDriverId(null);
          setPurpose("");
          setCost("");
        },
      },
    );
  };

  return (
    <EntrySection
      title="Trips / itineraries"
      form={
        <div className="grid gap-2 sm:grid-cols-2">
          <DateField value={date} onChange={setDate} placeholder="Date *" />
          <MemberPicker
            workspaceId={workspaceId}
            selectedUserId={driverId}
            onSelect={setDriverId}
            trigger={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="justify-start font-normal"
              >
                {driverId ? (driverName(driverId) ?? "Driver") : "Driver"}
              </Button>
            }
          />
          <Input
            placeholder="Origin"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
          />
          <Input
            placeholder="Destination"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          />
          <Input
            type="number"
            placeholder="Distance (km)"
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
          />
          <Input
            type="number"
            placeholder="Cost"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
          <Input
            className="sm:col-span-2"
            placeholder="Purpose"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          />
          <Button
            size="sm"
            className="sm:col-span-2"
            disabled={!date || m.addTrip.isPending}
            onClick={add}
          >
            <Plus className="h-3.5 w-3.5" /> Add trip
          </Button>
        </div>
      }
    >
      {data.trips.map((t) => (
        <EntryRow
          key={t.id}
          primary={
            [t.origin, t.destination].filter(Boolean).join(" → ") ||
            t.purpose ||
            "Trip"
          }
          secondary={[
            formatDateMedium(t.date),
            driverName(t.driverId) ?? t.driver,
            t.distanceKm != null ? `${t.distanceKm} km` : null,
            t.purpose,
          ]
            .filter(Boolean)
            .join(" · ")}
          right={
            t.cost != null ? (
              <span className="text-xs text-muted-foreground">
                {formatMoney(t.cost, currency)}
              </span>
            ) : undefined
          }
          onDelete={async () => {
            if (
              await confirm({
                title: "Remove trip?",
                description: "This permanently deletes this trip.",
              })
            ) {
              m.removeTrip.mutate(t.id);
            }
          }}
        />
      ))}
    </EntrySection>
  );
}

function CustodyTab({
  data,
  m,
  workspaceId,
}: {
  data: AssetDetail;
  m: Mutations;
  workspaceId: string;
}) {
  const confirm = useConfirm();
  const current = data.custody.find((c) => !c.releasedAt);
  return (
    <div className="space-y-4 py-2">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
        <div className="flex items-center gap-2">
          {current?.userId ? (
            <>
              <ColoredAvatar
                name={current.userName}
                image={current.userImage}
                seed={current.userId}
                className="h-8 w-8"
              />
              <div>
                <div className="text-sm font-medium">
                  {current.userName ?? current.userId}
                </div>
                <div className="text-xs text-muted-foreground">
                  Current custodian
                </div>
              </div>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">
              No custodian assigned
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <MemberPicker
            workspaceId={workspaceId}
            selectedUserId={current?.userId}
            onSelect={(userId) =>
              m.setCustodian.mutate({ targetAssetId: data.asset.id, userId })
            }
            trigger={
              <Button variant="outline" size="sm">
                <UserPlus className="h-3.5 w-3.5" />{" "}
                {current ? "Transfer" : "Assign"}
              </Button>
            }
          />
          {current && (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (
                  await confirm({
                    title: "Release custodian?",
                    description:
                      "This releases the current custodian from this asset.",
                    confirmText: "Release",
                    destructive: true,
                  })
                ) {
                  m.releaseCustodian.mutate(data.asset.id);
                }
              }}
            >
              <UserMinus className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <h4 className="text-sm font-medium">History</h4>
        {data.custody.map((c) => (
          <div
            key={c.id}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
          >
            <ColoredAvatar
              name={c.userName}
              image={c.userImage}
              seed={c.userId ?? ""}
              className="h-6 w-6"
              fallbackClassName="text-[10px]"
            />
            <span className="flex-1 truncate">{c.userName ?? "Unknown"}</span>
            <span className="text-xs text-muted-foreground">
              {formatDateMedium(c.assignedAt)}
              {c.releasedAt
                ? ` → ${formatDateMedium(c.releasedAt)}`
                : " · current"}
            </span>
          </div>
        ))}
        {data.custody.length === 0 && (
          <p className="text-sm text-muted-foreground">No custody history.</p>
        )}
      </div>
    </div>
  );
}

const DISPOSAL_METHODS = [
  { value: "sold", label: "Sold" },
  { value: "scrapped", label: "Scrapped" },
  { value: "donated", label: "Donated" },
  { value: "written-off", label: "Written off" },
  { value: "lost", label: "Lost" },
];

function FinancialsTab({
  data,
  m,
  currency,
}: {
  data: AssetDetail;
  m: Mutations;
  currency: string;
}) {
  const { asset, depreciation: dep, disposal } = data;

  const confirm = useConfirm();
  const [method, setMethod] = useState(asset.depreciationMethod);
  const [life, setLife] = useState(
    asset.usefulLifeMonths != null ? String(asset.usefulLifeMonths) : "",
  );
  const [salvage, setSalvage] = useState(fromMinorUnits(asset.salvageValue));
  const [inService, setInService] = useState<Date | null>(
    asset.inServiceDate ? new Date(asset.inServiceDate) : null,
  );

  const saveDep = () =>
    m.update.mutate({
      id: asset.id,
      data: {
        depreciationMethod: method,
        usefulLifeMonths: life ? Number(life) : null,
        salvageValue: toMinorUnits(salvage),
        inServiceDate: inService ? inService.toISOString() : null,
      },
    });

  const [dDate, setDDate] = useState<Date | null>(new Date());
  const [dMethod, setDMethod] = useState("sold");
  const [dProceeds, setDProceeds] = useState("");
  const [dReason, setDReason] = useState("");
  const [dNotes, setDNotes] = useState("");

  const dispose = () => {
    if (!dDate) return;
    m.createDisposal.mutate({
      date: dDate.toISOString(),
      method: dMethod,
      proceeds: toMinorUnits(dProceeds),
      reason: dReason.trim() || null,
      notes: dNotes.trim() || null,
    });
  };

  const nbv = dep.netBookValue;
  const gainLoss =
    disposal && disposal.proceeds != null && nbv != null
      ? disposal.proceeds - nbv
      : null;

  return (
    <div className="space-y-6 py-2">
      <section className="space-y-3">
        <h4 className="text-sm font-medium">Depreciation (straight-line)</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger>
                <SelectValue>
                  {method === "straight-line" ? "Straight-line" : "None"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="straight-line">Straight-line</SelectItem>
                <SelectItem value="none">None</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Useful life (months)</Label>
            <Input
              type="number"
              value={life}
              onChange={(e) => setLife(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Salvage value</Label>
            <Input
              type="number"
              value={salvage}
              onChange={(e) => setSalvage(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">In-service date</Label>
            <DateField value={inService} onChange={setInService} />
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={saveDep}
          disabled={m.update.isPending}
        >
          Save depreciation
        </Button>

        <div className="grid grid-cols-3 gap-3 pt-1">
          <Field label="Net book value" value={formatMoney(nbv, currency)} />
          <Field
            label="Accumulated"
            value={formatMoney(dep.accumulatedDepreciation, currency)}
          />
          <Field
            label="Monthly"
            value={formatMoney(dep.monthlyDepreciation, currency)}
          />
        </div>

        {dep.schedule.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-1.5 font-medium">Year</th>
                  <th className="px-3 py-1.5 font-medium">Opening</th>
                  <th className="px-3 py-1.5 font-medium">Depreciation</th>
                  <th className="px-3 py-1.5 font-medium">Closing</th>
                </tr>
              </thead>
              <tbody>
                {dep.schedule.map((r) => (
                  <tr
                    key={r.year}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-3 py-1.5">{r.year}</td>
                    <td className="px-3 py-1.5">
                      {formatMoney(r.openingValue, currency)}
                    </td>
                    <td className="px-3 py-1.5">
                      {formatMoney(r.depreciation, currency)}
                    </td>
                    <td className="px-3 py-1.5">
                      {formatMoney(r.closingValue, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-medium">Disposal</h4>
        {disposal ? (
          <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span>
                <span className="text-muted-foreground">Method:</span>{" "}
                {labelOf(DISPOSAL_METHODS, disposal.method)}
              </span>
              <span>
                <span className="text-muted-foreground">Date:</span>{" "}
                {formatDateMedium(disposal.date)}
              </span>
              <span>
                <span className="text-muted-foreground">Proceeds:</span>{" "}
                {formatMoney(disposal.proceeds, currency)}
              </span>
              {gainLoss != null && (
                <span
                  className={cn(
                    "font-medium",
                    gainLoss >= 0 ? "text-emerald-600" : "text-rose-600",
                  )}
                >
                  {gainLoss >= 0 ? "Gain" : "Loss"} on disposal:{" "}
                  {formatMoney(Math.abs(gainLoss), currency)}
                </span>
              )}
            </div>
            {disposal.reason && (
              <p className="text-muted-foreground">{disposal.reason}</p>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                if (
                  await confirm({
                    title: "Remove disposal record?",
                    description:
                      "This permanently deletes this disposal record.",
                  })
                ) {
                  m.removeDisposal.mutate();
                }
              }}
            >
              Revert disposal
            </Button>
          </div>
        ) : (
          <div className="grid gap-2 rounded-lg border border-dashed border-border p-3 sm:grid-cols-2">
            <DateField
              value={dDate}
              onChange={setDDate}
              placeholder="Disposal date *"
            />
            <Select value={dMethod} onValueChange={setDMethod}>
              <SelectTrigger>
                <SelectValue>{labelOf(DISPOSAL_METHODS, dMethod)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {DISPOSAL_METHODS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              placeholder="Proceeds"
              value={dProceeds}
              onChange={(e) => setDProceeds(e.target.value)}
            />
            <Input
              placeholder="Reason"
              value={dReason}
              onChange={(e) => setDReason(e.target.value)}
            />
            <Textarea
              className="sm:col-span-2"
              rows={2}
              placeholder="Notes"
              value={dNotes}
              onChange={(e) => setDNotes(e.target.value)}
            />
            <Button
              size="sm"
              className="sm:col-span-2"
              onClick={dispose}
              disabled={!dDate || m.createDisposal.isPending}
            >
              Dispose asset
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

function FleetTab({
  data,
  m,
  currency,
  workspaceId,
}: {
  data: AssetDetail;
  m: Mutations;
  currency: string;
  workspaceId: string;
}) {
  const { data: wsUsers } = useGetActiveWorkspaceUsers(workspaceId);
  const members = (wsUsers?.members ?? []) as Array<{
    userId: string;
    user?: { name?: string | null } | null;
  }>;
  const driverName = (id: string | null) =>
    id ? (members.find((mm) => mm.userId === id)?.user?.name ?? null) : null;

  const confirm = useConfirm();
  const [mDate, setMDate] = useState<Date | null>(new Date());
  const [mValue, setMValue] = useState("");
  const [mUnit, setMUnit] = useState("km");
  const addMeter = () => {
    if (!mValue || !mDate) return;
    m.addMeter.mutate(
      { date: mDate.toISOString(), value: Number(mValue), unit: mUnit },
      { onSuccess: () => setMValue("") },
    );
  };

  const [fDate, setFDate] = useState<Date | null>(new Date());
  const [fVolume, setFVolume] = useState("");
  const [fCost, setFCost] = useState("");
  const [fOdo, setFOdo] = useState("");
  const [fDriver, setFDriver] = useState<string | null>(null);
  const addFuel = () => {
    if (!fDate) return;
    m.addFuel.mutate(
      {
        date: fDate.toISOString(),
        volume: fVolume ? Math.round(Number(fVolume) * 100) : null,
        cost: toMinorUnits(fCost),
        odometer: fOdo ? Number(fOdo) : null,
        driverId: fDriver,
      },
      {
        onSuccess: () => {
          setFVolume("");
          setFCost("");
          setFOdo("");
          setFDriver(null);
        },
      },
    );
  };

  // Fill-to-full economy: only fills with an odometer count, and the earliest
  // fill establishes the baseline distance — its fuel was burned before the
  // measured window, so it's excluded from both volume and cost. This avoids
  // the bias of dividing every litre ever logged by the odometer span.
  const odoLogs = data.fuelLogs
    .filter((f) => f.odometer != null)
    .sort((a, b) => (a.odometer as number) - (b.odometer as number));
  const kmRange =
    odoLogs.length >= 2
      ? (odoLogs[odoLogs.length - 1].odometer as number) -
        (odoLogs[0].odometer as number)
      : 0;
  const consumed = odoLogs.slice(1);
  const consumedVolumeL =
    consumed.reduce((a, f) => a + (f.volume ?? 0), 0) / 100;
  const consumedFuelCost = consumed.reduce((a, f) => a + (f.cost ?? 0), 0);
  const avgL100 = kmRange > 0 ? (consumedVolumeL / kmRange) * 100 : null;
  const costPerKm = kmRange > 0 ? consumedFuelCost / kmRange : null;

  return (
    <div className="space-y-6 py-2">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Odometer / meter readings</h4>
          {data.currentOdometer != null && (
            <span className="text-sm text-muted-foreground">
              Current: {data.currentOdometer.toLocaleString()}
            </span>
          )}
        </div>
        <div className="space-y-1.5">
          {data.meterReadings.map((r) => (
            <EntryRow
              key={r.id}
              primary={`${r.value.toLocaleString()} ${r.unit}`}
              secondary={formatDateMedium(r.date)}
              onDelete={async () => {
                if (
                  await confirm({
                    title: "Remove meter reading?",
                    description: "This permanently deletes this meter reading.",
                  })
                ) {
                  m.removeMeter.mutate(r.id);
                }
              }}
            />
          ))}
        </div>
        <div className="grid gap-2 rounded-lg border border-dashed border-border p-3 sm:grid-cols-2">
          <DateField value={mDate} onChange={setMDate} placeholder="Date *" />
          <div className="flex items-center gap-2">
            <Input
              type="number"
              placeholder="Reading *"
              value={mValue}
              onChange={(e) => setMValue(e.target.value)}
            />
            <Select value={mUnit} onValueChange={setMUnit}>
              <SelectTrigger className="w-24">
                <SelectValue>{mUnit}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="km">km</SelectItem>
                <SelectItem value="hours">hours</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            className="sm:col-span-2"
            disabled={!mValue || !mDate || m.addMeter.isPending}
            onClick={addMeter}
          >
            <Plus className="h-3.5 w-3.5" /> Add reading
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Fuel log</h4>
          {avgL100 != null && (
            <span className="text-xs text-muted-foreground">
              {avgL100.toFixed(1)} L/100km ·{" "}
              {costPerKm != null
                ? `${formatMoney(Math.round(costPerKm), currency)}/km`
                : "—"}
            </span>
          )}
        </div>
        <div className="space-y-1.5">
          {data.fuelLogs.map((f) => (
            <EntryRow
              key={f.id}
              primary={
                f.volume != null ? `${(f.volume / 100).toFixed(2)} L` : "Fuel"
              }
              secondary={[
                formatDateMedium(f.date),
                driverName(f.driverId) ?? f.driverName,
                f.odometer != null ? `${f.odometer.toLocaleString()} km` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              right={
                f.cost != null ? (
                  <span className="text-xs text-muted-foreground">
                    {formatMoney(f.cost, currency)}
                  </span>
                ) : undefined
              }
              onDelete={async () => {
                if (
                  await confirm({
                    title: "Remove fuel record?",
                    description: "This permanently deletes this fuel record.",
                  })
                ) {
                  m.removeFuel.mutate(f.id);
                }
              }}
            />
          ))}
        </div>
        <div className="grid gap-2 rounded-lg border border-dashed border-border p-3 sm:grid-cols-2">
          <DateField value={fDate} onChange={setFDate} placeholder="Date *" />
          <Input
            type="number"
            placeholder="Volume (L)"
            value={fVolume}
            onChange={(e) => setFVolume(e.target.value)}
          />
          <Input
            type="number"
            placeholder="Cost"
            value={fCost}
            onChange={(e) => setFCost(e.target.value)}
          />
          <Input
            type="number"
            placeholder="Odometer (km)"
            value={fOdo}
            onChange={(e) => setFOdo(e.target.value)}
          />
          <MemberPicker
            workspaceId={workspaceId}
            selectedUserId={fDriver}
            onSelect={setFDriver}
            trigger={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="justify-start font-normal sm:col-span-2"
              >
                {fDriver ? (driverName(fDriver) ?? "Driver") : "Driver"}
              </Button>
            }
          />
          <Button
            size="sm"
            className="sm:col-span-2"
            disabled={!fDate || m.addFuel.isPending}
            onClick={addFuel}
          >
            <Plus className="h-3.5 w-3.5" /> Add fuel entry
          </Button>
        </div>
      </section>
    </div>
  );
}

const ACTIVITY_VERBS: Record<string, string> = {
  created: "registered this asset",
  updated: "updated the details",
  custodian_changed: "assigned a custodian",
  custodian_released: "released the custodian",
};

function HistoryTab({ data }: { data: AssetDetail }) {
  if (data.activity.length === 0) {
    return (
      <p className="py-4 text-sm text-muted-foreground">No history yet.</p>
    );
  }
  return (
    <div className="space-y-1.5 py-2">
      {data.activity.map((a) => (
        <div
          key={a.id}
          className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
        >
          <ColoredAvatar
            name={a.userName}
            image={a.userImage}
            seed={a.userId ?? ""}
            className="h-6 w-6"
            fallbackClassName="text-[10px]"
          />
          <span className="flex-1 truncate">
            <span className="font-medium">{a.userName ?? "Someone"}</span>{" "}
            <span className="text-muted-foreground">
              {ACTIVITY_VERBS[a.type] ?? a.type}
            </span>
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatDateTime(a.createdAt)}
          </span>
        </div>
      ))}
    </div>
  );
}
