import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  CalendarClock,
  Handshake,
  Loader2,
  Pencil,
  Phone,
  Trash2,
  Undo2,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useConfirm } from "@/components/ui/confirm";
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
import {
  type Asset,
  type AssetRental,
  type AssetRentalInput,
  createAssetRental,
  deleteAssetRental,
  getAssetRentals,
  returnAssetRental,
  updateAssetRental,
} from "@/fetchers/asset-registry";
import { cn } from "@/lib/cn";
import { formatDateMedium } from "@/lib/format";
import {
  formatMoney,
  fromMinorUnits,
  toMinorUnits,
} from "@/lib/format-currency";
import { toast } from "@/lib/toast";
import { DateField } from "./date-field";

const RATE_PERIODS = [
  { value: "day", label: "per day" },
  { value: "week", label: "per week" },
  { value: "month", label: "per month" },
  { value: "fixed", label: "fixed fee" },
] as const;

function useRentals(workspaceId: string, assetId: string) {
  return useQuery({
    queryKey: ["asset-rentals", workspaceId, assetId],
    queryFn: () => getAssetRentals(workspaceId, assetId),
    enabled: !!workspaceId && !!assetId,
  });
}

function useRentalMutations(workspaceId: string, assetId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    for (const queryKey of [
      ["asset-rentals", workspaceId, assetId],
      ["asset", workspaceId, assetId],
      ["assets", workspaceId],
      ["asset-summary", workspaceId],
    ]) {
      qc.invalidateQueries({ queryKey });
    }
  };
  const onError = (error: unknown) =>
    toast.error(
      error instanceof Error ? error.message : "Something went wrong",
    );

  return {
    create: useMutation({
      mutationFn: (body: AssetRentalInput) =>
        createAssetRental(workspaceId, assetId, body),
      onSuccess: () => {
        invalidate();
        toast.success("Rental recorded");
      },
      onError,
    }),
    update: useMutation({
      mutationFn: ({
        id,
        body,
      }: {
        id: string;
        body: Parameters<typeof updateAssetRental>[3];
      }) => updateAssetRental(workspaceId, assetId, id, body),
      onSuccess: () => {
        invalidate();
        toast.success("Rental updated");
      },
      onError,
    }),
    markReturned: useMutation({
      mutationFn: ({
        id,
        body,
      }: {
        id: string;
        body: Parameters<typeof returnAssetRental>[3];
      }) => returnAssetRental(workspaceId, assetId, id, body),
      onSuccess: () => {
        invalidate();
        toast.success("Marked returned");
      },
      onError,
    }),
    remove: useMutation({
      mutationFn: (id: string) => deleteAssetRental(workspaceId, assetId, id),
      onSuccess: () => {
        invalidate();
        toast.success("Rental record deleted");
      },
      onError,
    }),
  };
}

/** Calendar-day comparison: picking the start day itself is never "before". */
function isBeforeDay(date: Date, reference: Date) {
  const day = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return day(date) < day(reference);
}

const isOverdue = (rental: AssetRental) =>
  !rental.returnedAt &&
  !!rental.dueAt &&
  new Date(rental.dueAt).getTime() < Date.now();

function terms(rental: AssetRental) {
  const parts: string[] = [];
  if (rental.rate != null) {
    const period =
      RATE_PERIODS.find((p) => p.value === rental.ratePeriod)?.label ?? "";
    parts.push(`${formatMoney(rental.rate, rental.currency)} ${period}`);
  } else {
    parts.push("Free of charge");
  }
  if (rental.deposit != null) {
    parts.push(
      `deposit ${formatMoney(rental.deposit, rental.currency)}${
        rental.returnedAt
          ? rental.depositReturned
            ? " (returned)"
            : " (kept)"
          : ""
      }`,
    );
  }
  return parts.join(" · ");
}

/**
 * Lending or renting an asset to someone outside the organisation: who has
 * it, on what terms, until when, and the condition it left and came back
 * in. Separate from custody, which names the member responsible for it.
 */
export function RentalsTab({
  asset,
  workspaceId,
}: {
  asset: Asset;
  workspaceId: string;
}) {
  const confirm = useConfirm();
  const { data: rentals = [], isLoading } = useRentals(workspaceId, asset.id);
  const m = useRentalMutations(workspaceId, asset.id);
  const [mode, setMode] = useState<
    | { kind: "new" }
    | { kind: "edit"; rental: AssetRental }
    | { kind: "return"; rental: AssetRental }
    | null
  >(null);

  const current = rentals.find((r) => !r.returnedAt) ?? null;
  const past = rentals.filter((r) => r.returnedAt);
  const cannotRent =
    asset.status === "disposed" || asset.status === "retired"
      ? `A ${asset.status} asset cannot be rented out.`
      : null;

  const removeRental = async (rental: AssetRental) => {
    if (
      await confirm({
        title: "Delete this rental record?",
        description: `The record of ${rental.renterName}'s rental will be removed from this asset's history. Use this only for a record made by mistake.`,
      })
    ) {
      m.remove.mutate(rental.id);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 py-2">
      {mode?.kind === "new" || mode?.kind === "edit" ? (
        <RentalForm
          currency={asset.currency || "MYR"}
          initial={mode.kind === "edit" ? mode.rental : null}
          pending={m.create.isPending || m.update.isPending}
          onCancel={() => setMode(null)}
          onSubmit={(body) => {
            if (mode.kind === "edit") {
              m.update.mutate(
                { id: mode.rental.id, body },
                { onSuccess: () => setMode(null) },
              );
            } else {
              m.create.mutate(body, { onSuccess: () => setMode(null) });
            }
          }}
        />
      ) : mode?.kind === "return" ? (
        <ReturnForm
          rental={mode.rental}
          pending={m.markReturned.isPending}
          onCancel={() => setMode(null)}
          onSubmit={(body) =>
            m.markReturned.mutate(
              { id: mode.rental.id, body },
              { onSuccess: () => setMode(null) },
            )
          }
        />
      ) : current ? (
        <div
          className={cn(
            "space-y-3 rounded-lg border p-3",
            isOverdue(current)
              ? "border-destructive/40 bg-destructive/5"
              : "border-amber-500/40 bg-amber-500/5",
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Badge
                  className={cn(
                    "border",
                    isOverdue(current)
                      ? "border-destructive/40 bg-destructive/10 text-destructive"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
                  )}
                >
                  {isOverdue(current) ? "Overdue" : "On rent"}
                </Badge>
                <span className="truncate font-medium text-sm">
                  {current.renterName}
                </span>
              </div>
              {current.renterOrganisation && (
                <p className="mt-1 flex items-center gap-1.5 text-muted-foreground text-xs">
                  <Building2 className="h-3 w-3" />
                  {current.renterOrganisation}
                </p>
              )}
              {(current.renterPhone || current.renterEmail) && (
                <p className="mt-0.5 flex items-center gap-1.5 text-muted-foreground text-xs">
                  <Phone className="h-3 w-3" />
                  {[current.renterPhone, current.renterEmail]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="sm"
                onClick={() => setMode({ kind: "return", rental: current })}
              >
                <Undo2 className="h-3.5 w-3.5" /> Mark returned
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                aria-label="Edit rental"
                onClick={() => setMode({ kind: "edit", rental: current })}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <Fact label="Out since" value={formatDateMedium(current.startAt)} />
            <Fact
              label="Due back"
              value={
                current.dueAt ? formatDateMedium(current.dueAt) : "Open-ended"
              }
            />
            <Fact label="Terms" value={terms(current)} />
            {current.renterIdNumber && (
              <Fact label="ID / reg. no." value={current.renterIdNumber} />
            )}
            {current.purpose && (
              <Fact label="Purpose" value={current.purpose} />
            )}
            {current.conditionOut && (
              <Fact label="Condition out" value={current.conditionOut} />
            )}
            {current.notes && <Fact label="Notes" value={current.notes} />}
            {current.createdByName && (
              <Fact label="Recorded by" value={current.createdByName} />
            )}
          </dl>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <div>
            <p className="font-medium text-sm">Not on rent</p>
            <p className="text-muted-foreground text-xs">
              {cannotRent ??
                "Record it here when it goes out to someone outside the organisation."}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={Boolean(cannotRent)}
            onClick={() => setMode({ kind: "new" })}
          >
            <Handshake className="h-3.5 w-3.5" /> Rent out
          </Button>
        </div>
      )}

      <div className="space-y-1.5">
        <h4 className="font-medium text-sm">Rental history</h4>
        {past.length === 0 ? (
          <p className="text-muted-foreground text-sm">No past rentals.</p>
        ) : (
          past.map((rental) => {
            const late =
              rental.dueAt &&
              rental.returnedAt &&
              new Date(rental.returnedAt) > new Date(rental.dueAt);
            return (
              <div
                key={rental.id}
                className="group flex items-start gap-3 rounded-md border border-border px-3 py-2 text-sm"
              >
                <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">
                      {rental.renterName}
                    </span>
                    {rental.renterOrganisation && (
                      <span className="truncate text-muted-foreground text-xs">
                        {rental.renterOrganisation}
                      </span>
                    )}
                    {late && (
                      <Badge className="border border-destructive/40 bg-destructive/10 text-destructive">
                        Returned late
                      </Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {formatDateMedium(rental.startAt)} →{" "}
                    {formatDateMedium(rental.returnedAt as string)} ·{" "}
                    {terms(rental)}
                  </p>
                  {rental.conditionIn && (
                    <p className="text-muted-foreground text-xs">
                      Came back: {rental.conditionIn}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 shrink-0 p-0 text-muted-foreground opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                  aria-label={`Delete rental record for ${rental.renterName}`}
                  onClick={() => removeRental(rental)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  );
}

function RentalForm({
  currency,
  initial,
  pending,
  onCancel,
  onSubmit,
}: {
  currency: string;
  initial: AssetRental | null;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (body: AssetRentalInput) => void;
}) {
  const [renterName, setRenterName] = useState(initial?.renterName ?? "");
  const [organisation, setOrganisation] = useState(
    initial?.renterOrganisation ?? "",
  );
  const [phone, setPhone] = useState(initial?.renterPhone ?? "");
  const [email, setEmail] = useState(initial?.renterEmail ?? "");
  const [idNumber, setIdNumber] = useState(initial?.renterIdNumber ?? "");
  const [purpose, setPurpose] = useState(initial?.purpose ?? "");
  const [startAt, setStartAt] = useState<Date | null>(
    initial ? new Date(initial.startAt) : new Date(),
  );
  const [dueAt, setDueAt] = useState<Date | null>(
    initial?.dueAt ? new Date(initial.dueAt) : null,
  );
  const [rate, setRate] = useState(fromMinorUnits(initial?.rate));
  const [ratePeriod, setRatePeriod] = useState<string>(
    initial?.ratePeriod ?? "day",
  );
  const [deposit, setDeposit] = useState(fromMinorUnits(initial?.deposit));
  const [conditionOut, setConditionOut] = useState(initial?.conditionOut ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const dueBeforeStart = startAt && dueAt ? isBeforeDay(dueAt, startAt) : false;
  const valid = renterName.trim() !== "" && startAt && !dueBeforeStart;

  return (
    <form
      className="space-y-3 rounded-lg border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || !startAt) return;
        const rateMinor = toMinorUnits(rate);
        onSubmit({
          renterName: renterName.trim(),
          renterOrganisation: organisation.trim() || null,
          renterPhone: phone.trim() || null,
          renterEmail: email.trim() || null,
          renterIdNumber: idNumber.trim() || null,
          purpose: purpose.trim() || null,
          startAt: startAt.toISOString(),
          dueAt: dueAt ? dueAt.toISOString() : null,
          rate: rateMinor,
          ratePeriod:
            rateMinor != null
              ? (ratePeriod as AssetRental["ratePeriod"])
              : null,
          deposit: toMinorUnits(deposit),
          conditionOut: conditionOut.trim() || null,
          notes: notes.trim() || null,
        });
      }}
    >
      <h4 className="font-medium text-sm">
        {initial ? "Edit rental" : "Rent out to someone external"}
      </h4>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Renter name" required>
          <Input
            value={renterName}
            onChange={(e) => setRenterName(e.target.value)}
            placeholder="Person collecting it"
            autoFocus
          />
        </Field>
        <Field label="Organisation">
          <Input
            value={organisation}
            onChange={(e) => setOrganisation(e.target.value)}
            placeholder="Company, association…"
          />
        </Field>
        <Field label="Phone">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="IC / passport / reg. no.">
          <Input
            value={idNumber}
            onChange={(e) => setIdNumber(e.target.value)}
          />
        </Field>
        <Field label="Purpose">
          <Input
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="e.g. community event"
          />
        </Field>
        <Field label="Out from" required>
          <DateField value={startAt} onChange={setStartAt} clearable={false} />
        </Field>
        <Field label="Due back">
          <DateField
            value={dueAt}
            onChange={setDueAt}
            placeholder="Open-ended"
          />
          {dueBeforeStart && (
            <p className="text-destructive text-xs">
              Must be on or after the start date.
            </p>
          )}
        </Field>
        <Field label={`Rate (${currency})`}>
          <div className="flex gap-1.5">
            <Input
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="Blank = free"
            />
            <Select
              value={ratePeriod}
              onValueChange={(v) => setRatePeriod(v ?? "day")}
            >
              <SelectTrigger className="w-32 shrink-0">
                <SelectValue>
                  {RATE_PERIODS.find((p) => p.value === ratePeriod)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {RATE_PERIODS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Field>
        <Field label={`Deposit (${currency})`}>
          <Input
            inputMode="decimal"
            value={deposit}
            onChange={(e) => setDeposit(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Condition when it went out">
        <Textarea
          rows={2}
          value={conditionOut}
          onChange={(e) => setConditionOut(e.target.value)}
          placeholder="Accessories included, existing scratches…"
        />
      </Field>
      <Field label="Notes">
        <Textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!valid || pending}>
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {initial ? "Save" : "Record rental"}
        </Button>
      </div>
    </form>
  );
}

function ReturnForm({
  rental,
  pending,
  onCancel,
  onSubmit,
}: {
  rental: AssetRental;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (body: {
    returnedAt: string;
    conditionIn: string | null;
    depositReturned: boolean;
  }) => void;
}) {
  const [returnedAt, setReturnedAt] = useState<Date | null>(new Date());
  const [conditionIn, setConditionIn] = useState("");
  const [depositReturned, setDepositReturned] = useState(
    rental.deposit != null,
  );
  const beforeStart = returnedAt
    ? isBeforeDay(returnedAt, new Date(rental.startAt))
    : false;

  return (
    <form
      className="space-y-3 rounded-lg border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!returnedAt || beforeStart) return;
        onSubmit({
          returnedAt: returnedAt.toISOString(),
          conditionIn: conditionIn.trim() || null,
          depositReturned,
        });
      }}
    >
      <h4 className="font-medium text-sm">
        Mark returned from {rental.renterName}
      </h4>
      <Field label="Returned on" required>
        <DateField
          value={returnedAt}
          onChange={setReturnedAt}
          clearable={false}
        />
        {beforeStart && (
          <p className="text-destructive text-xs">
            Cannot be before it went out.
          </p>
        )}
      </Field>
      <Field label="Condition on return">
        <Textarea
          rows={2}
          value={conditionIn}
          onChange={(e) => setConditionIn(e.target.value)}
          placeholder={
            rental.conditionOut
              ? `Went out: ${rental.conditionOut}`
              : "Anything missing or damaged?"
          }
        />
      </Field>
      {rental.deposit != null && (
        <div className="flex items-center gap-2 text-sm">
          <Checkbox
            id="deposit-returned"
            checked={depositReturned}
            onCheckedChange={(checked) => setDepositReturned(checked === true)}
          />
          <Label htmlFor="deposit-returned" className="font-normal">
            Deposit of {formatMoney(rental.deposit, rental.currency)} returned
            to the renter
          </Label>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={!returnedAt || beforeStart || pending}
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Mark returned
        </Button>
      </div>
    </form>
  );
}
