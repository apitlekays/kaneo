import { DEFAULT_ROLE_NAMES } from "@kaneo/permissions";
import { EllipsisIcon, MailIcon, ShieldIcon, TrashIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import useCancelInvitation from "@/hooks/mutations/workspace-user/use-cancel-invitation";
import useDeleteWorkspaceUser from "@/hooks/mutations/workspace-user/use-delete-workspace-user";
import useUpdateWorkspaceUserRole from "@/hooks/mutations/workspace-user/use-update-workspace-user-role";
import useWorkspaceRoles from "@/hooks/queries/workspace/use-workspace-roles";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatDateMedium } from "@/lib/format";
import { toast } from "@/lib/toast";
import type {
  WorkspaceUser,
  WorkspaceUserInvitation,
} from "@/types/workspace-user";
import { useAuth } from "../providers/auth-provider/hooks/use-auth";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ColoredAvatar } from "../ui/colored-avatar";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

type Props = {
  workspaceId: string;
  invitations: WorkspaceUserInvitation[];
  users: WorkspaceUser[];
};

// Names that are NOT "truly custom" — viewer/member/admin are seeded as
// editable workspace_role rows on every workspace creation, and owner is a
// static built-in. The Select already lists them as built-ins, so we filter
// them out of the custom-roles tail to avoid duplicate options.
const RESERVED_ROLE_NAMES = new Set<string>([...DEFAULT_ROLE_NAMES, "owner"]);

function capitalize(value: string): string {
  if (!value) return value;
  // Title-case hyphenated role names too, e.g. "global-admin" -> "Global Admin".
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function MembersTable({ workspaceId, invitations, users }: Props) {
  const { t } = useTranslation();
  const [memberToDelete, setMemberToDelete] = useState<WorkspaceUser | null>(
    null,
  );
  const [invitationToCancel, setInvitationToCancel] =
    useState<WorkspaceUserInvitation | null>(null);

  const { user: currentUser } = useAuth();
  const { mutateAsync: deleteWorkspaceUser, isPending: isDeleting } =
    useDeleteWorkspaceUser();
  const { mutateAsync: cancelInvitation, isPending: isCancelling } =
    useCancelInvitation();
  const { mutateAsync: updateMemberRole } = useUpdateWorkspaceUserRole();
  const { data: allWorkspaceRoles = [] } = useWorkspaceRoles(workspaceId);
  const { canManageTeam, canRemoveMembers, canInviteUsers } =
    useWorkspacePermission();
  const canChangeRoles = Boolean(canManageTeam());
  const canRemove = Boolean(canRemoveMembers());
  const canInvite = Boolean(canInviteUsers());

  const customRoles = allWorkspaceRoles.filter(
    (role) => !RESERVED_ROLE_NAMES.has(role.role),
  );

  // Owner first, then everyone else (stable on ties so the original
  // listMembers order is preserved within each group).
  const sortedUsers = [...users].sort((a, b) => {
    if (a.role === b.role) return 0;
    if (a.role === "owner") return -1;
    if (b.role === "owner") return 1;
    return 0;
  });

  const pendingInvitations = invitations.filter(
    (inv) => inv.status !== "accepted" && inv.status !== "canceled",
  );

  const handleChangeRole = async (member: WorkspaceUser, role: string) => {
    if (role === member.role) return;
    try {
      await updateMemberRole({ workspaceId, memberId: member.id, role });
      toast.success(t("team:membersTable.roleUpdateSuccess"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("team:membersTable.roleUpdateError"),
      );
    }
  };

  const handleDeleteMember = async () => {
    if (!memberToDelete) return;
    try {
      await deleteWorkspaceUser({
        workspaceId,
        userId: memberToDelete.user.email,
      });
      toast.success(t("team:membersTable.removeSuccess"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("team:membersTable.removeError"),
      );
    } finally {
      setMemberToDelete(null);
    }
  };

  const handleCancelInvitation = async () => {
    if (!invitationToCancel) return;
    try {
      await cancelInvitation({
        invitationId: invitationToCancel.id,
        workspaceId,
      });
      toast.success(t("team:membersTable.cancelInviteSuccess"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("team:membersTable.cancelInviteError"),
      );
    } finally {
      setInvitationToCancel(null);
    }
  };

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="ps-6 text-foreground font-medium">
              {t("team:membersTable.columns.name", {
                defaultValue: "Member",
              })}
            </TableHead>
            <TableHead className="text-foreground font-medium">
              {t("team:membersTable.columns.role", { defaultValue: "Role" })}
            </TableHead>
            <TableHead className="text-foreground font-medium">
              {t("team:membersTable.columns.joined", {
                defaultValue: "Joined",
              })}
            </TableHead>
            <TableHead className="w-px pe-6" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedUsers.map((member) => {
            const isSelf = currentUser?.id === member.userId;
            const showRoleSelect =
              canChangeRoles && !isSelf && member.role !== "owner";
            return (
              <TableRow key={member.user.email}>
                <TableCell className="ps-6 py-3">
                  <div className="flex items-center gap-3">
                    <ColoredAvatar
                      name={member.user.name}
                      image={member.user.image}
                      seed={member.userId}
                      className="size-8"
                      fallbackClassName="text-[11px]"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {member.user.name}
                        </span>
                        {isSelf ? (
                          <span className="text-xs text-muted-foreground">
                            ({t("team:members.you", { defaultValue: "You" })})
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {member.user.email}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="py-3">
                  {member.role === "owner" ? (
                    <Badge variant="outline" className="gap-1">
                      <ShieldIcon className="size-3" />
                      {t("team:roles.owner", { defaultValue: "Owner" })}
                    </Badge>
                  ) : showRoleSelect ? (
                    <Select
                      value={member.role}
                      onValueChange={(value) => {
                        if (typeof value === "string" && value) {
                          handleChangeRole(member, value);
                        }
                      }}
                    >
                      <SelectTrigger size="sm" className="h-8 w-32">
                        <SelectValue>
                          {t(`team:roles.${member.role}`, {
                            defaultValue: capitalize(member.role),
                          })}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="viewer">
                          {t("team:roles.viewer", { defaultValue: "Viewer" })}
                        </SelectItem>
                        <SelectItem value="member">
                          {t("team:roles.member", { defaultValue: "Member" })}
                        </SelectItem>
                        <SelectItem value="global-admin">
                          {t("team:roles.global-admin", {
                            defaultValue: "Global Admin",
                          })}
                        </SelectItem>
                        {/* Owner is intentionally NOT offered here: the better-auth
                            organization plugin requires an explicit ownership
                            transfer flow (a workspace must have exactly one owner).
                            That UI lives in workspace settings — TODO. */}
                        {customRoles.map((r) => (
                          <SelectItem key={r.id} value={r.role}>
                            {capitalize(r.role)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="secondary" className="capitalize">
                      {t(`team:roles.${member.role}`, {
                        defaultValue: capitalize(member.role),
                      })}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="py-3 text-sm text-muted-foreground tabular-nums">
                  {member.createdAt ? formatDateMedium(member.createdAt) : "—"}
                </TableCell>
                <TableCell className="pe-6 py-3 text-right">
                  {!isSelf && canRemove ? (
                    <Menu>
                      <MenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground"
                            aria-label={t("team:membersTable.ariaRemoveMember")}
                          />
                        }
                      >
                        <EllipsisIcon className="size-4" />
                      </MenuTrigger>
                      <MenuPopup align="end">
                        <MenuItem onClick={() => setMemberToDelete(member)}>
                          <TrashIcon className="size-4" />
                          {t("team:membersTable.removeMember")}
                        </MenuItem>
                      </MenuPopup>
                    </Menu>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}

          {pendingInvitations.map((invitation) => (
            <TableRow key={`invite-${invitation.id}`}>
              <TableCell className="ps-6 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <MailIcon className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {invitation.email}
                      </span>
                      <Badge
                        variant="outline"
                        size="sm"
                        className="font-mono text-[9px] uppercase tracking-wider"
                      >
                        {t("team:invitations.pendingBadge", {
                          defaultValue: "pending",
                        })}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {invitation.expiresAt
                        ? t("team:invitations.expires", {
                            defaultValue: "Expires {{date}}",
                            date: formatDateMedium(invitation.expiresAt),
                          })
                        : "—"}
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell className="py-3">
                <Badge variant="outline" className="capitalize">
                  {t(`team:roles.${invitation.role}`, {
                    defaultValue: capitalize(invitation.role),
                  })}
                </Badge>
              </TableCell>
              <TableCell className="py-3 text-sm text-muted-foreground">
                —
              </TableCell>
              <TableCell className="pe-6 py-3 text-right">
                {canInvite ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setInvitationToCancel(invitation)}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    aria-label={t("team:membersTable.ariaCancelInvitation")}
                  >
                    <TrashIcon className="size-4" />
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}

          {users.length === 0 && pendingInvitations.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="py-16 text-center">
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <p className="text-sm font-medium text-foreground">
                    {t("team:membersTable.emptyTitle")}
                  </p>
                  <p className="text-xs">
                    {t("team:membersTable.emptyDescription")}
                  </p>
                </div>
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      <AlertDialog
        open={!!memberToDelete}
        onOpenChange={(open) => !open && setMemberToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("team:membersTable.removeDialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("team:membersTable.removeDialogDescription", {
                name:
                  memberToDelete?.user.name || memberToDelete?.user.email || "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose disabled={isDeleting}>
              <Button variant="outline" size="sm" disabled={isDeleting}>
                {t("common:actions.cancel")}
              </Button>
            </AlertDialogClose>
            <AlertDialogClose
              onClick={handleDeleteMember}
              disabled={isDeleting}
            >
              <Button variant="destructive" size="sm" disabled={isDeleting}>
                <TrashIcon className="mr-2 size-4" />
                {t("team:membersTable.removeMember")}
              </Button>
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!invitationToCancel}
        onOpenChange={(open) => !open && setInvitationToCancel(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("team:membersTable.cancelDialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("team:membersTable.cancelDialogDescription", {
                email: invitationToCancel?.email ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose disabled={isCancelling}>
              <Button variant="outline" size="sm" disabled={isCancelling}>
                {t("common:actions.cancel")}
              </Button>
            </AlertDialogClose>
            <AlertDialogClose
              onClick={handleCancelInvitation}
              disabled={isCancelling}
            >
              <Button variant="destructive" size="sm" disabled={isCancelling}>
                <TrashIcon className="mr-2 size-4" />
                {t("team:membersTable.cancelInvitation")}
              </Button>
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default MembersTable;
