import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { DateField } from "@/components/assets/date-field";
import { MemberPicker } from "@/components/assets/member-picker";
import { Button } from "@/components/ui/button";
import { ColoredAvatar } from "@/components/ui/colored-avatar";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createWorkOrder, type WorkOrder } from "@/fetchers/asset-registry";
import { useAssets } from "@/hooks/queries/asset-registry/use-assets";
import {
  useWorkOrderMutations,
  useWorkOrders,
} from "@/hooks/queries/asset-registry/use-work-orders";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { cn } from "@/lib/cn";
import { formatDateMedium } from "@/lib/format";
import { toast } from "@/lib/toast";

type Member = { userId: string; user?: { name?: string | null } | null };
type WoMutations = ReturnType<typeof useWorkOrderMutations>;

const COLUMNS = [
  { value: "requested", label: "Requested" },
  { value: "scheduled", label: "Scheduled" },
  { value: "in-progress", label: "In Progress" },
  { value: "done", label: "Done" },
];
const STATUSES = [...COLUMNS, { value: "cancelled", label: "Cancelled" }];
const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];
const PRIORITY_TONE: Record<string, string> = {
  low: "text-muted-foreground",
  medium: "text-amber-600",
  high: "text-rose-600",
};

export function WorkOrderBoard({
  workspaceId,
  onOpenAsset,
}: {
  workspaceId: string;
  onOpenAsset: (assetId: string) => void;
}) {
  const { data: workOrders = [], isLoading } = useWorkOrders(workspaceId);
  const mutations = useWorkOrderMutations(workspaceId);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Work orders</h2>
        <NewWorkOrderDialog workspaceId={workspaceId} />
      </div>
      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-4">
          {COLUMNS.map((col) => {
            const items = workOrders.filter((w) => w.status === col.value);
            return (
              <div
                key={col.value}
                className="rounded-xl border border-border bg-muted/20"
              >
                <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span>{col.label}</span>
                  <span>{items.length}</span>
                </div>
                <div className="space-y-2 p-2">
                  {items.map((wo) => (
                    <WorkOrderCard
                      key={wo.id}
                      wo={wo}
                      workspaceId={workspaceId}
                      mutations={mutations}
                      onOpenAsset={onOpenAsset}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WorkOrderCard({
  wo,
  workspaceId,
  mutations,
  onOpenAsset,
}: {
  wo: WorkOrder;
  workspaceId: string;
  mutations: WoMutations;
  onOpenAsset: (assetId: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-2.5 text-sm shadow-sm/5">
      <button
        type="button"
        onClick={() => onOpenAsset(wo.assetId)}
        className="block w-full text-left"
      >
        <div className="text-xs text-muted-foreground">{wo.assetName}</div>
        <div className="font-medium">{wo.title}</div>
      </button>
      <div className="mt-1.5 flex items-center gap-2 text-xs">
        <span
          className={cn("font-medium capitalize", PRIORITY_TONE[wo.priority])}
        >
          {wo.priority}
        </span>
        {wo.dueDate && (
          <span className="text-muted-foreground">
            · {formatDateMedium(wo.dueDate)}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <MemberPicker
          workspaceId={workspaceId}
          selectedUserId={wo.assigneeId}
          onSelect={(userId) =>
            mutations.update.mutate({
              woId: wo.id,
              body: { assigneeId: userId },
            })
          }
          trigger={
            <button type="button" className="flex items-center gap-1.5">
              {wo.assigneeId ? (
                <ColoredAvatar
                  name={wo.assigneeName}
                  image={wo.assigneeImage}
                  seed={wo.assigneeId}
                  className="h-5 w-5"
                  fallbackClassName="text-[9px]"
                />
              ) : (
                <span className="text-xs text-muted-foreground">Assign</span>
              )}
            </button>
          }
        />
        <div className="flex items-center gap-1">
          <Select
            value={wo.status}
            onValueChange={(status) =>
              mutations.update.mutate({ woId: wo.id, body: { status } })
            }
          >
            <SelectTrigger size="sm" className="h-7 w-28 text-xs">
              <SelectValue>
                {STATUSES.find((s) => s.value === wo.status)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => mutations.remove.mutate(wo.id)}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function NewWorkOrderDialog({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { data: assets = [] } = useAssets(workspaceId);
  const { data: wsUsers } = useGetActiveWorkspaceUsers(workspaceId);

  const [assetId, setAssetId] = useState("");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("medium");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [due, setDue] = useState<Date | null>(null);

  const create = useMutation({
    mutationFn: () =>
      createWorkOrder(workspaceId, assetId, {
        title: title.trim(),
        priority,
        assigneeId,
        dueDate: due ? due.toISOString() : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["work-orders", workspaceId] });
      toast.success("Work order created");
      setOpen(false);
      setTitle("");
      setAssetId("");
      setAssigneeId(null);
      setDue(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const assignee = ((wsUsers?.members ?? []) as Member[]).find(
    (m) => m.userId === assigneeId,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" /> New work order
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New work order</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 px-6 pb-4">
          <Select value={assetId} onValueChange={setAssetId}>
            <SelectTrigger>
              <SelectValue>
                {assets.find((a) => a.id === assetId)?.name ?? "Select asset *"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {assets.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Title *"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger>
                <SelectValue>
                  {PRIORITIES.find((p) => p.value === priority)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DateField value={due} onChange={setDue} placeholder="Due date" />
          </div>
          <MemberPicker
            workspaceId={workspaceId}
            selectedUserId={assigneeId}
            onSelect={setAssigneeId}
            trigger={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="justify-start font-normal"
              >
                {assignee ? (assignee.user?.name ?? "Assigned") : "Assign to…"}
              </Button>
            }
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={!assetId || !title.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
