import { useQueryClient } from "@tanstack/react-query";
import { Check, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ColoredAvatar } from "@/components/ui/colored-avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  addProjectMember,
  approveProjectRequest,
  denyProjectRequest,
} from "@/fetchers/project-member";
import { useProjectMembers } from "@/hooks/queries/project-member/use-project-members";
import { useProjectRequests } from "@/hooks/queries/project-member/use-project-requests";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { authClient } from "@/lib/auth-client";
import { toast } from "@/lib/toast";

const MAX_AVATARS = 6;

export default function ProjectMembersBar({
  projectId,
}: {
  projectId: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: workspace } = useActiveWorkspace();
  const { isAdmin } = useWorkspacePermission();
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id;
  const { data: members = [] } = useProjectMembers(projectId);
  const { data: workspaceUsers } = useGetActiveWorkspaceUsers(
    workspace?.id ?? "",
  );

  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  const myRole = members.find((m) => m.userId === currentUserId)?.role;
  const canAdd = isAdmin || myRole === "manager";
  const { data: requests = [] } = useProjectRequests(projectId, canAdd);

  const refetchMembers = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["project-members", projectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["project-requests", projectId],
      }),
    ]);
  };

  const handleApprove = async (userId: string) => {
    try {
      await approveProjectRequest(projectId, userId);
      await refetchMembers();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed");
    }
  };

  const handleDeny = async (userId: string) => {
    try {
      await denyProjectRequest(projectId, userId);
      await refetchMembers();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed");
    }
  };

  const memberIds = useMemo(
    () => new Set(members.map((m) => m.userId)),
    [members],
  );
  const addableUsers = (workspaceUsers?.members ?? []).filter(
    (m: { userId: string }) => !memberIds.has(m.userId),
  );

  const shown = members.slice(0, MAX_AVATARS);
  const overflow = members.length - shown.length;

  const handleAdd = async (userId: string) => {
    setAdding(userId);
    try {
      await addProjectMember(projectId, userId, "member");
      await queryClient.invalidateQueries({
        queryKey: ["project-members", projectId],
      });
      toast.success(t("settings:projectMembers.addSuccess"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:projectMembers.addError"),
      );
    } finally {
      setAdding(null);
    }
  };

  if (members.length === 0 && !canAdd) return null;

  return (
    <div className="inline-flex items-center gap-1.5">
      <TooltipProvider>
        <div className="flex items-center -space-x-2">
          {shown.map((member) => (
            <Tooltip key={member.userId}>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <ColoredAvatar
                  name={member.name}
                  image={member.image}
                  seed={member.userId}
                  className="h-6 w-6 border-2 border-background"
                  fallbackClassName="text-[10px]"
                />
              </TooltipTrigger>
              <TooltipContent side="bottom">{member.name}</TooltipContent>
            </Tooltip>
          ))}
          {overflow > 0 && (
            <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-medium text-muted-foreground">
              +{overflow}
            </div>
          )}
        </div>
      </TooltipProvider>

      {canAdd && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="relative h-6 w-6 rounded-full p-0"
                title={t("settings:projectMembers.add")}
              />
            }
          >
            <Plus className="h-3.5 w-3.5" />
            {requests.length > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                {requests.length}
              </span>
            )}
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="start">
            <p className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">
              {t("settings:projectMembers.addPlaceholder")}
            </p>
            <div className="max-h-64 overflow-y-auto">
              {addableUsers.length === 0 ? (
                <div className="px-1 py-1.5 text-xs text-muted-foreground">
                  {t("settings:projectMembers.noneToAdd")}
                </div>
              ) : (
                addableUsers.map(
                  (m: {
                    userId: string;
                    user?: {
                      name?: string;
                      email?: string;
                      image?: string | null;
                    };
                  }) => (
                    <button
                      key={m.userId}
                      type="button"
                      disabled={adding === m.userId}
                      onClick={() => handleAdd(m.userId)}
                      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
                    >
                      <ColoredAvatar
                        name={m.user?.name}
                        image={m.user?.image}
                        seed={m.userId}
                        className="h-6 w-6"
                        fallbackClassName="text-[10px]"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {m.user?.name || m.user?.email || m.userId}
                      </span>
                    </button>
                  ),
                )
              )}
            </div>

            {requests.length > 0 && (
              <div className="mt-2 border-t border-border/60 pt-2">
                <p className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">
                  {t("settings:projectMembers.requestsTitle")}
                </p>
                {requests.map((request) => (
                  <div
                    key={request.userId}
                    className="flex items-center gap-2 px-1.5 py-1.5"
                  >
                    <ColoredAvatar
                      name={request.name}
                      image={request.image}
                      seed={request.userId}
                      className="h-6 w-6"
                      fallbackClassName="text-[10px]"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {request.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleApprove(request.userId)}
                      className="text-muted-foreground hover:text-success-foreground"
                      title={t("settings:projectMembers.approve")}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeny(request.userId)}
                      className="text-muted-foreground hover:text-destructive"
                      title={t("settings:projectMembers.deny")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
