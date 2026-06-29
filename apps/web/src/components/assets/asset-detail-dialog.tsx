import {
  FileText,
  ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { AssetBarcode } from "@/components/assets/asset-barcode";
import { DateField } from "@/components/assets/date-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
  ASSET_CATEGORIES,
  ASSET_STATUSES,
  COST_CATEGORIES,
  labelOf,
  RENEWAL_TYPES,
  STATUS_TONES,
} from "@/lib/asset-constants";
import { cn } from "@/lib/cn";
import { formatDateMedium } from "@/lib/format";
import { formatMoney, toMinorUnits } from "@/lib/format-currency";
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
  const currency = asset.currency || "MYR";

  return (
    <>
      <DialogHeader>
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
              onClick={() => {
                if (
                  window.confirm(
                    `Delete "${asset.name}"? This cannot be undone.`,
                  )
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
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="files">Files ({data.files.length})</TabsTrigger>
          <TabsTrigger value="renewals">
            Renewals ({data.renewals.length})
          </TabsTrigger>
          <TabsTrigger value="maintenance">
            Maintenance ({data.maintenance.length})
          </TabsTrigger>
          <TabsTrigger value="costs">Costs ({data.costs.length})</TabsTrigger>
          <TabsTrigger value="trips">Trips ({data.trips.length})</TabsTrigger>
          <TabsTrigger value="label">Label</TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto pt-3">
          <TabsContent value="overview">
            <OverviewTab data={data} currency={currency} />
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
            <TripsTab data={data} m={m} currency={currency} />
          </TabsContent>
          <TabsContent value="label">
            <div className="space-y-3 py-2">
              <AssetBarcode serial={asset.serialNumber} />
              {asset.assetTag && (
                <p className="text-sm text-muted-foreground">
                  Asset tag:{" "}
                  <span className="font-medium">{asset.assetTag}</span>
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.print()}
              >
                Print
              </Button>
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </>
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
}: {
  data: AssetDetail;
  currency: string;
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
      <Field label="Location" value={a.location} />
      <Field label="Assigned to" value={a.assignedTo} />
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
  onDelete,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
  right?: ReactNode;
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
                onClick={() => m.removeFile.mutate(f.id)}
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
            onDelete={() => m.removeFile.mutate(f.id)}
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
  const [type, setType] = useState("road-tax");
  const [label, setLabel] = useState("");
  const [due, setDue] = useState<Date | null>(null);
  const [cost, setCost] = useState("");
  const now = Date.now();

  const add = () => {
    if (!due) return;
    m.addRenewal.mutate(
      {
        type,
        label: label.trim() || null,
        dueDate: due.toISOString(),
        cost: toMinorUnits(cost),
      },
      {
        onSuccess: () => {
          setLabel("");
          setDue(null);
          setCost("");
        },
      },
    );
  };

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
          <Button
            size="sm"
            className="sm:col-span-2"
            disabled={!due || m.addRenewal.isPending}
            onClick={add}
          >
            <Plus className="h-3.5 w-3.5" /> Add renewal
          </Button>
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
            onDelete={() => m.removeRenewal.mutate(r.id)}
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
          onDelete={() => m.removeMaintenance.mutate(e.id)}
        />
      ))}
    </EntrySection>
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
          onDelete={() => m.removeCost.mutate(c.id)}
        />
      ))}
    </EntrySection>
  );
}

function TripsTab({
  data,
  m,
  currency,
}: {
  data: AssetDetail;
  m: Mutations;
  currency: string;
}) {
  const [date, setDate] = useState<Date | null>(new Date());
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [distance, setDistance] = useState("");
  const [driver, setDriver] = useState("");
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
        driver: driver.trim() || null,
        purpose: purpose.trim() || null,
        cost: toMinorUnits(cost),
      },
      {
        onSuccess: () => {
          setOrigin("");
          setDestination("");
          setDistance("");
          setDriver("");
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
          <Input
            placeholder="Driver"
            value={driver}
            onChange={(e) => setDriver(e.target.value)}
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
            t.driver,
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
          onDelete={() => m.removeTrip.mutate(t.id)}
        />
      ))}
    </EntrySection>
  );
}
