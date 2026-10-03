import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  CircleDashed,
  Gavel,
  Loader2,
  ShieldAlert,
  Undo2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  DISPOSAL_REASONS,
  type DisposalRequest,
  type DisposalStep,
  getAssetDisposalRequests,
  proposeDisposal,
  withdrawDisposal,
} from "@/fetchers/asset-registry";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { toast } from "@/lib/toast";

/** Matches MIN_PROPOSAL_JUSTIFICATION on the server. */
export const MIN_JUSTIFICATION = 30;

const STATUS_COPY: Record<
  DisposalRequest["status"],
  { label: string; tone: string }
> = {
  proposed: {
    label: "Awaiting committee",
    tone: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  },
  awaiting_ceo: {
    label: "Awaiting CEO approval",
    tone: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  },
  approved: {
    label: "Approved for disposal",
    tone: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  disposed: {
    label: "Disposed",
    tone: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  not_supported: {
    label: "Not supported by committee",
    tone: "border-border bg-muted text-muted-foreground",
  },
  rejected: {
    label: "Rejected by CEO",
    tone: "border-border bg-muted text-muted-foreground",
  },
  withdrawn: {
    label: "Withdrawn",
    tone: "border-border bg-muted text-muted-foreground",
  },
  reverted: {
    label: "Disposal reverted",
    tone: "border-border bg-muted text-muted-foreground",
  },
};

const STEP_COPY: Record<DisposalStep["outcome"], string> = {
  proposed: "proposed disposal",
  supported: "supported the proposal",
  not_supported: "did not support the proposal",
  approved: "approved the disposal",
  rejected: "rejected the disposal",
  withdrawn: "withdrew the proposal",
  recorded: "recorded the disposal",
};

const ACTED_AS: Record<string, string> = {
  custodian: "custodian",
  page_admin: "asset manager",
  chair: "committee chair",
  secretary: "committee secretary",
  ceo: "CEO",
  acting_ceo: "acting CEO",
  recorder: "asset manager",
  override: "global admin override",
};

const OPEN = new Set(["proposed", "awaiting_ceo", "approved"]);

function reasonLabel(value: string) {
  return (
    DISPOSAL_REASONS.find((r) => r.value === value)?.label ??
    (value === "override" ? "Recorded directly" : value)
  );
}

/**
 * The disposal approval process for one asset: propose (custodian), then
 * committee chair, then CEO — each step with its justification on record.
 * The physical disposal (method, date, proceeds) is recorded under
 * Financials once the CEO has approved.
 */
export function DisposalTab({
  asset,
  workspaceId,
  onRecordDisposal,
}: {
  asset: Asset;
  workspaceId: string;
  onRecordDisposal: () => void;
}) {
  const qc = useQueryClient();
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id;
  const [proposing, setProposing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState("");

  const key = ["asset-disposal-requests", workspaceId, asset.id];
  const { data: requests = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: () => getAssetDisposalRequests(workspaceId, asset.id),
    enabled: !!workspaceId,
  });
  const invalidate = () => {
    for (const k of [
      key,
      ["asset", workspaceId, asset.id],
      ["assets", workspaceId],
      ["asset-summary", workspaceId],
      ["disposal-requests", workspaceId],
    ]) {
      qc.invalidateQueries({ queryKey: k });
    }
  };
  const onError = (error: unknown) =>
    toast.error(
      error instanceof Error ? error.message : "Something went wrong",
    );

  const withdraw = useMutation({
    mutationFn: (request: DisposalRequest) =>
      withdrawDisposal(
        workspaceId,
        asset.id,
        request.id,
        withdrawReason.trim(),
      ),
    onSuccess: () => {
      setWithdrawing(false);
      setWithdrawReason("");
      invalidate();
      toast.success("Proposal withdrawn");
    },
    onError,
  });

  const current = requests.find((r) => OPEN.has(r.status)) ?? null;
  const past = requests.filter((r) => r !== current);

  const isCustodian = asset.currentCustodianId === userId;
  const canPropose =
    !current &&
    !["disposed", "retired"].includes(asset.status) &&
    (asset.currentCustodianId ? isCustodian : true);
  const blockedReason = current
    ? null
    : asset.status === "disposed"
      ? "This asset is disposed."
      : asset.status === "retired"
        ? "A retired asset cannot be proposed for disposal."
        : asset.currentCustodianId && !isCustodian
          ? "Only this asset's custodian can propose it for disposal."
          : null;

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 py-2">
      {proposing ? (
        <ProposeForm
          asset={asset}
          onCancel={() => setProposing(false)}
          onDone={() => {
            setProposing(false);
            invalidate();
          }}
          workspaceId={workspaceId}
        />
      ) : current ? (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge className={cn("border", STATUS_COPY[current.status].tone)}>
              {STATUS_COPY[current.status].label}
            </Badge>
            {current.pendingDeciderName && (
              <span className="text-muted-foreground text-xs">
                Waiting on {current.pendingDeciderName}
              </span>
            )}
          </div>
          <Timeline request={current} />

          {current.status === "approved" && (
            <div className="flex items-center justify-between gap-3 rounded-md bg-muted/50 p-2.5 text-sm">
              <span>
                Approved. Record how and when it was physically disposed of.
              </span>
              <Button size="sm" onClick={onRecordDisposal}>
                Record disposal
              </Button>
            </div>
          )}

          {current.status === "proposed" &&
            current.proposedBy === userId &&
            (withdrawing ? (
              <div className="space-y-2">
                <Textarea
                  rows={2}
                  value={withdrawReason}
                  onChange={(e) => setWithdrawReason(e.target.value)}
                  placeholder="Why are you withdrawing it?"
                  aria-label="Reason for withdrawing"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setWithdrawing(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!withdrawReason.trim() || withdraw.isPending}
                    onClick={() => withdraw.mutate(current)}
                  >
                    Withdraw proposal
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setWithdrawing(true)}
                >
                  <Undo2 className="h-3.5 w-3.5" /> Withdraw
                </Button>
              </div>
            ))}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <div>
            <p className="font-medium text-sm">No disposal in progress</p>
            <p className="text-muted-foreground text-xs">
              {blockedReason ??
                "Disposal goes to the disposal committee's chair, then the CEO."}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!canPropose}
            onClick={() => setProposing(true)}
          >
            <Gavel className="h-3.5 w-3.5" /> Propose disposal
          </Button>
        </div>
      )}

      {past.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium text-sm">Earlier proposals</h4>
          {past.map((request) => (
            <details
              key={request.id}
              className="rounded-md border border-border px-3 py-2 text-sm"
            >
              <summary className="flex cursor-pointer items-center gap-2">
                <Badge
                  className={cn("border", STATUS_COPY[request.status].tone)}
                >
                  {STATUS_COPY[request.status].label}
                </Badge>
                <span className="text-muted-foreground text-xs">
                  {formatDateTime(request.createdAt)} ·{" "}
                  {reasonLabel(request.reasonCategory)}
                </span>
              </summary>
              <div className="pt-2">
                <Timeline request={request} />
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function Timeline({ request }: { request: DisposalRequest }) {
  return (
    <ol className="space-y-2">
      {request.steps.map((step) => {
        const Icon =
          step.outcome === "not_supported" ||
          step.outcome === "rejected" ||
          step.outcome === "withdrawn"
            ? XCircle
            : step.outcome === "proposed"
              ? CircleDashed
              : CheckCircle2;
        return (
          <li key={step.id} className="flex gap-2 text-sm">
            <Icon
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0",
                Icon === XCircle ? "text-rose-600" : "text-muted-foreground",
              )}
            />
            <div className="min-w-0">
              <p>
                <span className="font-medium">
                  {step.actorName ?? "Someone"}
                </span>{" "}
                <span className="text-muted-foreground">
                  ({ACTED_AS[step.actedAs] ?? step.actedAs})
                </span>{" "}
                {STEP_COPY[step.outcome]}
                {step.outcome === "proposed" &&
                  ` — ${reasonLabel(request.reasonCategory)}`}
              </p>
              <p className="break-words text-muted-foreground">
                “{step.justification}”
              </p>
              <p className="text-muted-foreground text-xs">
                {formatDateTime(step.createdAt)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ProposeForm({
  asset,
  workspaceId,
  onCancel,
  onDone,
}: {
  asset: Asset;
  workspaceId: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState<string>("");
  const [justification, setJustification] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [serial, setSerial] = useState("");

  const propose = useMutation({
    mutationFn: () =>
      proposeDisposal(workspaceId, asset.id, {
        reasonCategory: reason,
        justification: justification.trim(),
        confirmServiceable: true,
        confirmSerial: serial.trim(),
      }),
    onSuccess: () => {
      toast.success("Proposed for disposal — sent to the committee");
      onDone();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Not proposed"),
  });

  const remaining = MIN_JUSTIFICATION - justification.trim().length;
  const serialMatches = serial.trim() === asset.serialNumber;
  const ready = reason && remaining <= 0 && confirmed && serialMatches;

  return (
    <form
      className="space-y-3 rounded-lg border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) propose.mutate();
      }}
    >
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div>
          <h4 className="font-medium text-sm">Propose disposal</h4>
          <p className="text-muted-foreground text-xs">
            This goes to the disposal committee's chair, then the CEO. The asset
            is marked “Proposed for disposal” and cannot be rented out until
            they decide.
          </p>
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">
          Reason<span className="text-destructive"> *</span>
        </Label>
        <Select value={reason} onValueChange={(v) => setReason(v ?? "")}>
          <SelectTrigger aria-label="Reason">
            <SelectValue placeholder="Why should it be disposed of?">
              {DISPOSAL_REASONS.find((r) => r.value === reason)?.label ??
                "Why should it be disposed of?"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {DISPOSAL_REASONS.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="disposal-justification" className="text-xs">
          Justification<span className="text-destructive"> *</span>
        </Label>
        <Textarea
          id="disposal-justification"
          rows={3}
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          placeholder="What is wrong with it, what was tried, and why it is not worth keeping"
        />
        <p
          className={cn(
            "text-xs",
            remaining > 0 ? "text-muted-foreground" : "text-emerald-600",
          )}
        >
          {remaining > 0
            ? `${remaining} more character${remaining === 1 ? "" : "s"} needed`
            : "Enough detail for the committee"}
        </p>
      </div>

      <div className="flex items-start gap-2 text-sm">
        <Checkbox
          id="disposal-confirm"
          checked={confirmed}
          onCheckedChange={(checked) => setConfirmed(checked === true)}
        />
        <Label htmlFor="disposal-confirm" className="font-normal leading-snug">
          I confirm this item is no longer serviceable for the organisation.
        </Label>
      </div>

      <div className="space-y-1">
        <Label htmlFor="disposal-serial" className="text-xs">
          Type the serial number <code>{asset.serialNumber}</code> to confirm
        </Label>
        <Input
          id="disposal-serial"
          value={serial}
          onChange={(e) => setSerial(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          variant="destructive"
          disabled={!ready || propose.isPending}
        >
          {propose.isPending && (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          )}
          Propose disposal
        </Button>
      </div>
    </form>
  );
}
