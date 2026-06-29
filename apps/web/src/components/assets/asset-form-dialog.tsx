import { type ReactNode, useState } from "react";
import { DateField } from "@/components/assets/date-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Textarea } from "@/components/ui/textarea";
import type { Asset, AssetInput } from "@/fetchers/asset-registry";
import { useAssetMutations } from "@/hooks/queries/asset-registry/use-asset-mutations";
import {
  ASSET_CATEGORIES,
  ASSET_STATUSES,
  labelOf,
} from "@/lib/asset-constants";
import { fromMinorUnits, toMinorUnits } from "@/lib/format-currency";

type Props = {
  workspaceId: string;
  asset?: Asset;
  trigger: ReactNode;
};

const orNull = (value: string) => (value.trim() ? value.trim() : null);

export function AssetFormDialog({ workspaceId, asset, trigger }: Props) {
  const isEdit = Boolean(asset);
  const [open, setOpen] = useState(false);
  const { create, update } = useAssetMutations(workspaceId, asset?.id);

  const [name, setName] = useState(asset?.name ?? "");
  const [category, setCategory] = useState(asset?.category ?? "it-equipment");
  const [status, setStatus] = useState(asset?.status ?? "active");
  const [manufacturer, setManufacturer] = useState(asset?.manufacturer ?? "");
  const [model, setModel] = useState(asset?.model ?? "");
  const [registrationNumber, setRegistrationNumber] = useState(
    asset?.registrationNumber ?? "",
  );
  const [location, setLocation] = useState(asset?.location ?? "");
  const [assignedTo, setAssignedTo] = useState(asset?.assignedTo ?? "");
  const [vendor, setVendor] = useState(asset?.vendor ?? "");
  const [purchaseDate, setPurchaseDate] = useState<Date | null>(
    asset?.purchaseDate ? new Date(asset.purchaseDate) : null,
  );
  const [purchaseCost, setPurchaseCost] = useState(
    fromMinorUnits(asset?.purchaseCost),
  );
  const [currency, setCurrency] = useState(asset?.currency ?? "MYR");
  const [assetTag, setAssetTag] = useState(asset?.assetTag ?? "");
  const [notes, setNotes] = useState(asset?.notes ?? "");

  const pending = create.isPending || update.isPending;

  const submit = () => {
    if (!name.trim()) return;
    const data: AssetInput = {
      name: name.trim(),
      category,
      status,
      manufacturer: orNull(manufacturer),
      model: orNull(model),
      registrationNumber: orNull(registrationNumber),
      location: orNull(location),
      assignedTo: orNull(assignedTo),
      vendor: orNull(vendor),
      assetTag: orNull(assetTag),
      notes: orNull(notes),
      currency: currency.trim() || "MYR",
      purchaseDate: purchaseDate ? purchaseDate.toISOString() : null,
      purchaseCost: toMinorUnits(purchaseCost),
    };
    const onDone = { onSuccess: () => setOpen(false) };
    if (isEdit && asset) {
      update.mutate({ id: asset.id, data }, onDone);
    } else {
      create.mutate(data, onDone);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit asset" : "Register new asset"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 px-6 pb-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Name *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Toyota Hiace, MacBook Pro 16”"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue>{labelOf(ASSET_CATEGORIES, category)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ASSET_CATEGORIES.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue>{labelOf(ASSET_STATUSES, status)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ASSET_STATUSES.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Manufacturer / Make</Label>
            <Input
              value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Model</Label>
            <Input value={model} onChange={(e) => setModel(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Registration / Plate No.</Label>
            <Input
              value={registrationNumber}
              onChange={(e) => setRegistrationNumber(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Asset tag</Label>
            <Input
              value={assetTag}
              onChange={(e) => setAssetTag(e.target.value)}
              placeholder="Your own label (optional)"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Location</Label>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Assigned to</Label>
            <Input
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              placeholder="Person or department"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Purchase date</Label>
            <DateField value={purchaseDate} onChange={setPurchaseDate} />
          </div>
          <div className="space-y-1.5">
            <Label>Vendor / Supplier</Label>
            <Input value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Purchase cost</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={purchaseCost}
              onChange={(e) => setPurchaseCost(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Currency</Label>
            <Input
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              maxLength={3}
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !name.trim()}>
            {isEdit ? "Save changes" : "Register asset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
