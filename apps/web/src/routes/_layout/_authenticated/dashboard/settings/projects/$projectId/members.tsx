import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Loader2, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ColoredAvatar } from "@/components/ui/colored-avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addProjectMember,
  approveProjectRequest,
  denyProjectRequest,
  removeProjectMember,
} from "@/fetchers/project-member";
import { useProjectMembers } from "@/hooks/queries/project-member/use-project-members";
import { useProjectRequests } from "@/hooks/queries/project-member/use-project-requests";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { authClient } from "@/lib/auth-client";
import { toast } from "@/lib/toast";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/projects/$projectId/members",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId } = Route.useParams();
  const queryClient = useQueryClient();
  const { data: workspace } = useActiveWorkspace();
  const { isAdmin } = useWorkspacePermission();
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id;

  const { data: members = [], isLoading } = useProjectMembers(projectId);
  const { data: workspaceUsers } = useGetActiveWorkspaceUsers(
    workspace?.id ?? "",
  );
  const handleApprove = async (userId: string) => {
    try {
      await approveProjectRequest(projectId, userId);
      await Promise.all([
        invalidate(),
        queryClient.invalidateQueries({
          queryKey: ["project-requests", projectId],
        }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed");
    }
  };

  const handleDeny = async (userId: string) => {
    try {
      await denyProjectRequest(projectId, userId);
      await queryClient.invalidateQueries({
        queryKey: ["project-requests", projectId],
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed");
    }
  };

  const [addUserId, setAddUserId] = useState("");
  const [busy, setBusy] = useState(false);

  const myRole = members.find((m) => m.userId === currentUserId)?.role;
  const canManage = isAdmin || myRole === "manager";

  const { data: requests = [] } = useProjectRequests(projectId, canManage);

  const memberIds = useMemo(
    () => new Set(members.map((m) => m.userId)),
    [members],
  );
  const addableUsers = (workspaceUsers?.members ?? []).filter(
    (m: { userId: string }) => !memberIds.has(m.userId),
  );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["project-members", projectId] });

  const handleAdd = async () => {
    if (!addUserId) return;
    setBusy(true);
    try {
      await addProjectMember(projectId, addUserId, "member");
      setAddUserId("");
      await invalidate();
      toast.success(t("settings:projectMembers.addSuccess"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:projectMembers.addError"),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (userId: string) => {
    try {
      await removeProjectMember(projectId, userId);
      await invalidate();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:projectMembers.removeError"),
      );
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">
          {t("settings:projectMembers.title")}
        </h1>
        <p className="text-muted-foreground">
          {t("settings:projectMembers.subtitle")}
        </p>
      </div>

      {canManage && (
        <div className="flex items-center gap-2">
          <Select
            value={addUserId}
            onValueChange={(value) => setAddUserId(value ?? "")}
          >
            <SelectTrigger className="h-9 flex-1">
              <SelectValue
                placeholder={t("settings:projectMembers.addPlaceholder")}
              />
            </SelectTrigger>
            <SelectContent>
              {addableUsers.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  {t("settings:projectMembers.noneToAdd")}
                </div>
              ) : (
                addableUsers.map(
                  (m: {
                    userId: string;
                    user?: { name?: string; email?: string };
                  }) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.user?.name || m.user?.email || m.userId}
                    </SelectItem>
                  ),
                )
              )}
            </SelectContent>
          </Select>
          <Button onClick={handleAdd} disabled={!addUserId || busy} size="sm">
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {t("settings:projectMembers.add")}
          </Button>
        </div>
      )}

      <div className="rounded-lg border divide-y divide-border/60">
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          members.map((member) => (
            <div
              key={member.userId}
              className="flex items-center gap-3 px-4 py-2.5"
            >
              <ColoredAvatar
                name={member.name}
                image={member.image}
                seed={member.userId}
                className="h-8 w-8"
                fallbackClassName="text-xs"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{member.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {member.email}
                </p>
              </div>
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {member.role === "manager"
                  ? t("settings:projectMembers.roleManager")
                  : t("settings:projectMembers.roleMember")}
              </span>
              {canManage && member.userId !== currentUserId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => handleRemove(member.userId)}
                  title={t("settings:projectMembers.remove")}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))
        )}
      </div>

      {canManage && requests.length > 0 && (
        <div className="space-y-2">
          <div className="space-y-1">
            <h2 className="text-md font-medium">
              {t("settings:projectMembers.requestsTitle")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("settings:projectMembers.requestsSubtitle")}
            </p>
          </div>
          <div className="rounded-lg border divide-y divide-border/60">
            {requests.map((request) => (
              <div
                key={request.userId}
                className="flex items-center gap-3 px-4 py-2.5"
              >
                <ColoredAvatar
                  name={request.name}
                  image={request.image}
                  seed={request.userId}
                  className="h-8 w-8"
                  fallbackClassName="text-xs"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{request.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {request.email}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1"
                  onClick={() => handleApprove(request.userId)}
                >
                  <Check className="h-3.5 w-3.5" />
                  {t("settings:projectMembers.approve")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDeny(request.userId)}
                  title={t("settings:projectMembers.deny")}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
