import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Crown,
  Loader2,
  Plus,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import { useState } from "react";
import { MemberPicker } from "@/components/assets/member-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ColoredAvatar } from "@/components/ui/colored-avatar";
import { useConfirm } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addCommitteeMember,
  type Committee,
  type CommitteeMember,
  type CommitteeRole,
  createCommittee,
  listCommitteeMembers,
  listCommittees,
  listOfficeHolders,
  type OfficeHolder,
  setOfficeHolder,
  updateCommittee,
  updateCommitteeMember,
} from "@/fetchers/committees";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";

const ROLES: { value: CommitteeRole; label: string }[] = [
  { value: "chair", label: "Chair" },
  { value: "secretary", label: "Secretary" },
  { value: "member", label: "Member" },
];

const onError = (error: unknown) =>
  toast.error(error instanceof Error ? error.message : "Something went wrong");

/**
 * The organisation's committees and office holders. Approval flows route
 * through them — asset disposal goes to the disposal committee's chair and
 * then the CEO. Everyone with General Management access can read this;
 * only global admins can change it.
 */
export function Committees({ workspaceId }: { workspaceId: string }) {
  const { isAdmin } = useWorkspacePermission();
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const { data: committees = [], isLoading } = useQuery({
    queryKey: ["committees", workspaceId],
    queryFn: () => listCommittees(workspaceId),
    enabled: !!workspaceId,
  });

  const create = useMutation({
    mutationFn: (name: string) => createCommittee(workspaceId, { name }),
    onSuccess: () => {
      setNewName("");
      qc.invalidateQueries({ queryKey: ["committees", workspaceId] });
      toast.success("Committee created");
    },
    onError,
  });

  const visible = committees.filter((c) => showInactive || c.active);
  const inactiveCount = committees.filter((c) => !c.active).length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="font-semibold text-lg">Committees</h2>
        <p className="text-muted-foreground text-sm">
          The organisation's committees and office holders. Approvals are routed
          through them — for example, an asset disposal goes to the disposal
          committee's chair, then the CEO.
          {!isAdmin && " Only global admins can make changes."}
        </p>
      </div>

      <OfficeHolders workspaceId={workspaceId} canEdit={isAdmin} />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-medium text-sm">Committees</h3>
          {inactiveCount > 0 && (
            <button
              type="button"
              className="text-muted-foreground text-xs underline-offset-2 hover:underline"
              onClick={() => setShowInactive((v) => !v)}
            >
              {showInactive ? "Hide" : "Show"} {inactiveCount} inactive
            </button>
          )}
        </div>

        {isAdmin && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) create.mutate(newName.trim());
            }}
          >
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New committee, e.g. Jawatankuasa Pelupusan Aset"
            />
            <Button
              type="submit"
              size="sm"
              disabled={!newName.trim() || create.isPending}
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </form>
        )}

        {isLoading ? (
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-border border-dashed py-10 text-center">
            <Users className="h-6 w-6 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">
              No committees yet.
              {isAdmin && " Add one above, then add its members."}
            </p>
          </div>
        ) : (
          visible.map((committee) => (
            <CommitteeCard
              key={committee.id}
              workspaceId={workspaceId}
              committee={committee}
              canEdit={isAdmin}
            />
          ))
        )}
      </section>
    </div>
  );
}

function OfficeHolders({
  workspaceId,
  canEdit,
}: {
  workspaceId: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const { data: holders = [] } = useQuery({
    queryKey: ["office-holders", workspaceId],
    queryFn: () => listOfficeHolders(workspaceId),
    enabled: !!workspaceId,
  });
  const save = useMutation({
    mutationFn: ({
      office,
      holderUserId,
      actingUserId,
    }: {
      office: OfficeHolder;
      holderUserId: string | null;
      actingUserId: string | null;
    }) =>
      setOfficeHolder(workspaceId, office.key, { holderUserId, actingUserId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["office-holders", workspaceId] });
      toast.success("Office holder updated");
    },
    onError,
  });

  return (
    <section className="space-y-2 rounded-lg border border-border p-4">
      <h3 className="font-medium text-sm">Office holders</h3>
      {holders.map((office) => (
        <div key={office.key} className="grid gap-2 sm:grid-cols-2">
          <Holder
            label={office.label}
            userId={office.holderUserId}
            name={office.holderName}
            image={office.holderImage}
            workspaceId={workspaceId}
            canEdit={canEdit}
            onChange={(userId) =>
              save.mutate({
                office,
                holderUserId: userId,
                actingUserId: office.actingUserId,
              })
            }
          />
          <Holder
            label={`Acting ${office.label}`}
            hint="Decides in their place, including on their own proposals"
            userId={office.actingUserId}
            name={office.actingName}
            image={office.actingImage}
            workspaceId={workspaceId}
            canEdit={canEdit}
            onChange={(userId) =>
              save.mutate({
                office,
                holderUserId: office.holderUserId,
                actingUserId: userId,
              })
            }
          />
        </div>
      ))}
    </section>
  );
}

function Holder({
  label,
  hint,
  userId,
  name,
  image,
  workspaceId,
  canEdit,
  onChange,
}: {
  label: string;
  hint?: string;
  userId: string | null;
  name: string | null;
  image: string | null;
  workspaceId: string;
  canEdit: boolean;
  onChange: (userId: string | null) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        {userId ? (
          <ColoredAvatar
            name={name}
            image={image}
            seed={userId}
            className="h-7 w-7"
            fallbackClassName="text-[10px]"
          />
        ) : (
          <div className="h-7 w-7 rounded-full border border-border border-dashed" />
        )}
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs" title={hint}>
            {label}
          </p>
          <p className="truncate text-sm">
            {name ?? <span className="text-muted-foreground">Not set</span>}
          </p>
        </div>
      </div>
      {canEdit && (
        <div className="flex shrink-0 gap-1">
          <MemberPicker
            workspaceId={workspaceId}
            selectedUserId={userId}
            onSelect={(id) => onChange(id)}
            trigger={
              <Button variant="outline" size="sm" className="h-7">
                {userId ? "Change" : "Set"}
              </Button>
            }
          />
          {userId && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              aria-label={`Clear ${label}`}
              onClick={() => onChange(null)}
            >
              <UserMinus className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function CommitteeCard({
  workspaceId,
  committee,
  canEdit,
}: {
  workspaceId: string;
  committee: Committee;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [externalName, setExternalName] = useState("");
  const [newRole, setNewRole] = useState<CommitteeRole>("member");

  const membersKey = ["committee-members", workspaceId, committee.id];
  const { data: members = [], isLoading } = useQuery({
    queryKey: membersKey,
    queryFn: () => listCommitteeMembers(workspaceId, committee.id),
    enabled: open,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: membersKey });
    qc.invalidateQueries({ queryKey: ["committees", workspaceId] });
    qc.invalidateQueries({ queryKey: ["disposal-settings", workspaceId] });
  };

  const add = useMutation({
    mutationFn: (body: { userId?: string; name?: string }) =>
      addCommitteeMember(workspaceId, committee.id, { ...body, role: newRole }),
    onSuccess: () => {
      setExternalName("");
      refresh();
    },
    onError,
  });
  const updateMember = useMutation({
    mutationFn: ({
      member,
      body,
    }: {
      member: CommitteeMember;
      body: { role?: CommitteeRole; active?: boolean };
    }) => updateCommitteeMember(workspaceId, committee.id, member.id, body),
    onSuccess: refresh,
    onError,
  });
  const updateBody = useMutation({
    mutationFn: (active: boolean) =>
      updateCommittee(workspaceId, committee.id, { active }),
    onSuccess: refresh,
    onError,
  });

  const active = members.filter((m) => m.active);
  const chair = active.find((m) => m.role === "chair");
  const takenUserIds = new Set(active.map((m) => m.userId).filter(Boolean));

  return (
    <div
      className={cn(
        "rounded-lg border border-border",
        !committee.active && "opacity-60",
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="flex-1 font-medium text-sm">{committee.name}</span>
        {!committee.active && <Badge variant="outline">Inactive</Badge>}
      </button>

      {open && (
        <div className="space-y-3 border-border border-t px-4 py-3">
          {committee.description && (
            <p className="text-muted-foreground text-sm">
              {committee.description}
            </p>
          )}
          {!isLoading && !chair && (
            <p className="text-amber-700 text-xs dark:text-amber-300">
              No chair set — approvals routed to this committee cannot be
              decided until one is.
            </p>
          )}

          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : active.length === 0 ? (
            <p className="text-muted-foreground text-sm">No members yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {active.map((member) => (
                <li
                  key={member.id}
                  className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm"
                >
                  {member.userId ? (
                    <ColoredAvatar
                      name={member.displayName}
                      image={member.userImage}
                      seed={member.userId}
                      className="h-6 w-6"
                      fallbackClassName="text-[10px]"
                    />
                  ) : (
                    <div className="h-6 w-6 rounded-full border border-border border-dashed" />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {member.displayName}
                    {!member.userId && (
                      <span className="ml-1.5 text-muted-foreground text-xs">
                        (external — cannot decide approvals)
                      </span>
                    )}
                  </span>
                  {member.role === "chair" && (
                    <Crown className="h-3.5 w-3.5 text-amber-600" />
                  )}
                  {canEdit ? (
                    <>
                      <Select
                        value={member.role}
                        onValueChange={(role) =>
                          role &&
                          updateMember.mutate({
                            member,
                            body: { role: role as CommitteeRole },
                          })
                        }
                      >
                        <SelectTrigger className="h-7 w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              {r.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        aria-label={`Remove ${member.displayName}`}
                        onClick={async () => {
                          if (
                            await confirm({
                              title: "Remove from committee?",
                              description: `${member.displayName} will no longer be a member of ${committee.name}. Past meetings and decisions keep their record.`,
                              confirmText: "Remove",
                            })
                          ) {
                            updateMember.mutate({
                              member,
                              body: { active: false },
                            });
                          }
                        }}
                      >
                        <UserMinus className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  ) : (
                    <Badge variant="outline" className="capitalize">
                      {member.role}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canEdit && (
            <div className="space-y-2 rounded-md bg-muted/40 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground text-xs">Add as</span>
                <Select
                  value={newRole}
                  onValueChange={(role) =>
                    role && setNewRole(role as CommitteeRole)
                  }
                >
                  <SelectTrigger className="h-7 w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <MemberPicker
                  workspaceId={workspaceId}
                  onSelect={(userId) => {
                    if (takenUserIds.has(userId)) {
                      toast.error("Already a member of this committee");
                      return;
                    }
                    add.mutate({ userId });
                  }}
                  trigger={
                    <Button variant="outline" size="sm" className="h-7">
                      <UserPlus className="h-3.5 w-3.5" /> Workspace member
                    </Button>
                  }
                />
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (externalName.trim())
                    add.mutate({ name: externalName.trim() });
                }}
              >
                <Input
                  className="h-8"
                  value={externalName}
                  onChange={(e) => setExternalName(e.target.value)}
                  placeholder="…or an external member's name"
                />
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  disabled={!externalName.trim() || add.isPending}
                >
                  Add
                </Button>
              </form>
            </div>
          )}

          {canEdit && (
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => updateBody.mutate(!committee.active)}
              >
                {committee.active
                  ? "Deactivate committee"
                  : "Reactivate committee"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Committees;
