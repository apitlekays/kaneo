import {
  ChevronDown,
  ChevronRight,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useConfirm } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import {
  type TaskCost,
  taskCostReceiptUrl,
  uploadTaskCostReceipt,
} from "@/fetchers/project-finance";
import {
  useTaskCostMutations,
  useTaskCosts,
} from "@/hooks/queries/project/use-project-details";
import { formatDateMedium } from "@/lib/format";
import { formatRM, fromMinorUnits, toMinorUnits } from "@/lib/format-currency";
import { toast } from "@/lib/toast";

const RECEIPT_ACCEPT =
  "application/pdf,image/png,image/jpeg,image/webp,image/heic";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The costs recorded on a task or subtask. Their total across the project's
 * tasks is the project's Actual Expenditure on its details ribbon.
 */
export default function TaskCosts({
  taskId,
  projectId,
}: {
  taskId: string;
  projectId: string;
}) {
  const { data } = useTaskCosts(taskId);
  const mutations = useTaskCostMutations(taskId, projectId);
  const confirm = useConfirm();
  const [isOpen, setIsOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const items = data?.items ?? [];
  const total = items.reduce((sum, item) => sum + item.amount, 0);

  const remove = async (cost: TaskCost) => {
    const ok = await confirm({
      title: "Delete this cost?",
      description: `${cost.description} (${formatRM(cost.amount)}) comes off the actual expenditure, and its receipt is deleted.`,
      confirmText: "Delete",
    });
    if (ok) mutations.remove.mutate(cost.id);
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1 text-muted-foreground text-sm transition-colors hover:text-foreground"
            >
              {isOpen ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
              <span>Costs</span>
            </button>
          </CollapsibleTrigger>
          {items.length > 0 && (
            <span className="ml-0.5 text-muted-foreground text-xs tabular-nums">
              {formatRM(total)}
            </span>
          )}
        </div>
        {data?.canAdd && !adding && (
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            onClick={() => {
              setIsOpen(true);
              setAdding(true);
              setEditingId(null);
            }}
          >
            <Plus className="size-3.5" />
            Add cost
          </Button>
        )}
      </div>
      <CollapsibleContent>
        <div className="mt-2 space-y-1.5">
          {items.length === 0 && !adding && (
            <p className="px-1 text-muted-foreground text-xs">
              No costs recorded on this task.
            </p>
          )}
          {items.map((cost) =>
            editingId === cost.id ? (
              <CostForm
                key={cost.id}
                taskId={taskId}
                initial={cost}
                busy={mutations.update.isPending}
                onCancel={() => setEditingId(null)}
                onSubmit={(body) =>
                  mutations.update.mutate(
                    { costId: cost.id, body },
                    { onSuccess: () => setEditingId(null) },
                  )
                }
              />
            ) : (
              <div
                key={cost.id}
                className="group flex items-start gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate">{cost.description}</p>
                  <p className="text-muted-foreground text-xs">
                    {formatDateMedium(cost.incurredOn)}
                    {cost.createdByName && ` · ${cost.createdByName}`}
                    {cost.receiptFilename && (
                      <>
                        {" · "}
                        <a
                          href={taskCostReceiptUrl(taskId, cost.id)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-0.5 underline-offset-2 hover:underline"
                        >
                          <Paperclip className="size-3" />
                          {cost.receiptFilename}
                        </a>
                      </>
                    )}
                  </p>
                </div>
                <span className="shrink-0 font-medium tabular-nums">
                  {formatRM(cost.amount)}
                </span>
                {cost.canEdit && (
                  <span className="flex shrink-0 gap-0.5 opacity-60 group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Edit ${cost.description}`}
                      onClick={() => {
                        setEditingId(cost.id);
                        setAdding(false);
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Delete ${cost.description}`}
                      onClick={() => remove(cost)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </span>
                )}
              </div>
            ),
          )}
          {adding && (
            <CostForm
              taskId={taskId}
              busy={mutations.create.isPending}
              onCancel={() => setAdding(false)}
              onSubmit={(body) =>
                mutations.create.mutate(
                  {
                    description: body.description ?? "",
                    amount: body.amount ?? 0,
                    incurredOn: body.incurredOn ?? today(),
                    receipt: body.receipt ?? undefined,
                  },
                  { onSuccess: () => setAdding(false) },
                )
              }
            />
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

type CostFormValues = {
  description?: string;
  amount?: number;
  incurredOn?: string;
  receipt?: Awaited<ReturnType<typeof uploadTaskCostReceipt>> | null;
};

function CostForm({
  taskId,
  initial,
  busy,
  onCancel,
  onSubmit,
}: {
  taskId: string;
  initial?: TaskCost;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (values: CostFormValues) => void;
}) {
  const [description, setDescription] = useState(initial?.description ?? "");
  const [amount, setAmount] = useState(fromMinorUnits(initial?.amount));
  const [incurredOn, setIncurredOn] = useState(
    initial ? initial.incurredOn.slice(0, 10) : today(),
  );
  const [file, setFile] = useState<File | null>(null);
  const [removeReceipt, setRemoveReceipt] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sen = toMinorUnits(amount.replace(/,/g, ""));
    if (!description.trim()) return setError("Say what the cost was for");
    if (sen === null || sen <= 0)
      return setError("Enter an amount above RM 0, for example 120.50");
    setError(null);
    let receipt: CostFormValues["receipt"];
    if (file) {
      setUploading(true);
      try {
        receipt = await uploadTaskCostReceipt(taskId, file);
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : "The receipt could not be uploaded",
        );
        return;
      } finally {
        setUploading(false);
      }
    } else if (removeReceipt) receipt = null;
    onSubmit({
      description: description.trim(),
      amount: sen,
      incurredOn,
      ...(receipt !== undefined && { receipt }),
    });
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-2 rounded-md border border-border bg-muted/30 p-2.5"
    >
      <Input
        aria-label="What the cost was for"
        placeholder="What was it for? e.g. Courier to client"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        autoFocus
      />
      <div className="grid grid-cols-2 gap-2">
        <Input
          aria-label="Amount in RM"
          inputMode="decimal"
          placeholder="Amount (RM)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Input
          aria-label="Date incurred"
          type="date"
          value={incurredOn}
          max={today()}
          onChange={(e) => setIncurredOn(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="inline-flex cursor-pointer items-center gap-1 text-muted-foreground hover:text-foreground">
          <Paperclip className="size-3.5" />
          {file
            ? file.name
            : initial?.receiptFilename && !removeReceipt
              ? `Replace ${initial.receiptFilename}`
              : "Attach receipt (optional)"}
          <input
            type="file"
            accept={RECEIPT_ACCEPT}
            className="sr-only"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setRemoveReceipt(false);
            }}
          />
        </label>
        {initial?.receiptFilename && !file && !removeReceipt && (
          <button
            type="button"
            className="text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setRemoveReceipt(true)}
          >
            Remove receipt
          </button>
        )}
      </div>
      {error && (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="xs" disabled={busy || uploading}>
          {uploading ? "Uploading…" : initial ? "Save" : "Add cost"}
        </Button>
      </div>
    </form>
  );
}
