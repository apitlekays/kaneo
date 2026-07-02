import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type ApprovalChain,
  type ApprovalStep,
  approvalChains,
} from "@/fetchers/correspondence";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";

type Option = { value: string; label: string };

type StepDraft = {
  key: string;
  approverType: "role" | "users";
  approverRefs: string[];
  quorum: number;
  slaHours: string;
  mode: "sequential" | "parallel";
};

const emptyStep = (): StepDraft => ({
  key: crypto.randomUUID(),
  approverType: "role",
  approverRefs: [],
  quorum: 1,
  slaHours: "",
  mode: "sequential",
});

function toDraft(step: ApprovalStep): StepDraft {
  return {
    key: crypto.randomUUID(),
    approverType: step.approverType,
    approverRefs: step.approverRefs ?? [],
    quorum: step.quorum ?? 1,
    slaHours: step.slaHours != null ? String(step.slaHours) : "",
    mode: step.mode ?? "sequential",
  };
}

export function ApprovalChainsEditor({
  workspaceId,
  userOptions,
}: {
  workspaceId: string;
  userOptions: Option[];
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: chains = [], isLoading } = useQuery({
    queryKey: ["gm-config", "approval-chains", workspaceId],
    queryFn: () => approvalChains.list(workspaceId),
    enabled: !!workspaceId,
  });

  const invalidate = () =>
    qc.invalidateQueries({
      queryKey: ["gm-config", "approval-chains", workspaceId],
    });
  const onError = (error: unknown) =>
    toast.error(
      error instanceof Error ? error.message : "Something went wrong",
    );

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ApprovalChain | null>(null);
  const [name, setName] = useState("");
  const [letterType, setLetterType] = useState("");
  const [steps, setSteps] = useState<StepDraft[]>([]);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        appliesTo: letterType && letterType !== "any" ? { letterType } : null,
        steps: steps.map(
          (s, i): ApprovalStep => ({
            stepOrder: i + 1,
            approverType: s.approverType,
            approverRefs: s.approverRefs,
            quorum: s.quorum,
            slaHours: s.slaHours === "" ? null : Number(s.slaHours),
            mode: s.mode,
          }),
        ),
      };
      return editing
        ? approvalChains.update(workspaceId, editing.id, body)
        : approvalChains.create(workspaceId, body);
    },
    onSuccess: () => {
      invalidate();
      toast.success("Saved");
      setOpen(false);
    },
    onError,
  });

  const remove = useMutation({
    mutationFn: (id: string) => approvalChains.deactivate(workspaceId, id),
    onSuccess: () => {
      invalidate();
      toast.success("Removed");
    },
    onError,
  });

  const startAdd = () => {
    setEditing(null);
    setName("");
    setLetterType("any");
    setSteps([emptyStep()]);
    setOpen(true);
  };

  const startEdit = async (chain: ApprovalChain) => {
    const full = await approvalChains.get(workspaceId, chain.id);
    setEditing(full);
    setName(full.name);
    setLetterType(
      (full.appliesTo as { letterType?: string } | null)?.letterType ?? "any",
    );
    setSteps((full.steps ?? []).map(toDraft));
    setOpen(true);
  };

  const setStep = (index: number, patch: Partial<StepDraft>) =>
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    );
  const toggleRef = (index: number, ref: string) =>
    setSteps((prev) =>
      prev.map((s, i) =>
        i === index
          ? {
              ...s,
              approverRefs: s.approverRefs.includes(ref)
                ? s.approverRefs.filter((r) => r !== ref)
                : [...s.approverRefs, ref],
            }
          : s,
      ),
    );

  const askRemove = async (chain: ApprovalChain) => {
    if (
      await confirm({
        title: `Remove "${chain.name}"?`,
        description: "It will be deactivated, not permanently deleted.",
        confirmText: "Remove",
      })
    ) {
      remove.mutate(chain.id);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-base">Approval chain</h3>
          <p className="text-muted-foreground text-sm">
            Ordered approval steps for outgoing correspondence, selected by
            letter type.
          </p>
        </div>
        <Button size="sm" onClick={startAdd}>
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Applies to</TableHead>
              <TableHead className="w-20 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {chains.map((chain) => (
              <TableRow key={chain.id}>
                <TableCell>{chain.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {(chain.appliesTo as { letterType?: string } | null)
                    ?.letterType ?? "Any"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => startEdit(chain)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => askRemove(chain)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {chains.length === 0 && (
          <div className="py-10 text-center text-muted-foreground text-sm">
            No approval chains yet.
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[88vh] max-w-2xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit approval chain" : "Add approval chain"}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="External — legal"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Applies to letter type</Label>
                <Select value={letterType} onValueChange={setLetterType}>
                  <SelectTrigger>
                    <SelectValue>
                      {letterType === "any" || !letterType
                        ? "Any type"
                        : letterType.charAt(0).toUpperCase() +
                          letterType.slice(1)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any type</SelectItem>
                    <SelectItem value="external">External</SelectItem>
                    <SelectItem value="memo">Memo</SelectItem>
                    <SelectItem value="circular">Circular</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Steps</Label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSteps((prev) => [...prev, emptyStep()])}
                >
                  <Plus className="h-3.5 w-3.5" /> Add step
                </Button>
              </div>
              {steps.map((step, index) => (
                <div
                  key={step.key}
                  className="space-y-3 rounded-lg border border-border p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">
                      Step {index + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setSteps((prev) => prev.filter((_, i) => i !== index))
                      }
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Remove step"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Approver</Label>
                      <Select
                        value={step.approverType}
                        onValueChange={(v) =>
                          setStep(index, {
                            approverType: v as "role" | "users",
                            approverRefs: [],
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue>
                            {step.approverType === "users"
                              ? "Named users"
                              : "Role"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="role">Role</SelectItem>
                          <SelectItem value="users">Named users</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Mode</Label>
                      <Select
                        value={step.mode}
                        onValueChange={(v) =>
                          setStep(index, {
                            mode: v as "sequential" | "parallel",
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue>
                            {step.mode === "parallel"
                              ? "Parallel"
                              : "Sequential"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sequential">Sequential</SelectItem>
                          <SelectItem value="parallel">Parallel</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Quorum</Label>
                        <Input
                          type="number"
                          value={String(step.quorum)}
                          onChange={(e) =>
                            setStep(index, {
                              quorum: Number(e.target.value) || 1,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">SLA hrs</Label>
                        <Input
                          type="number"
                          value={step.slaHours}
                          onChange={(e) =>
                            setStep(index, { slaHours: e.target.value })
                          }
                        />
                      </div>
                    </div>
                  </div>
                  {step.approverType === "users" ? (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Approvers</Label>
                      <div className="flex flex-wrap gap-1.5">
                        {userOptions.map((u) => (
                          <button
                            key={u.value}
                            type="button"
                            onClick={() => toggleRef(index, u.value)}
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-xs",
                              step.approverRefs.includes(u.value)
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border text-muted-foreground hover:bg-muted",
                            )}
                          >
                            {u.label}
                          </button>
                        ))}
                        {userOptions.length === 0 && (
                          <span className="text-muted-foreground text-xs">
                            No workspace members found.
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Role keys</Label>
                      <Input
                        value={step.approverRefs.join(", ")}
                        placeholder="hod, secretariat"
                        onChange={(e) =>
                          setStep(index, {
                            approverRefs: e.target.value
                              .split(",")
                              .map((r) => r.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim() || save.isPending}
              onClick={() => save.mutate()}
            >
              {editing ? "Save changes" : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
