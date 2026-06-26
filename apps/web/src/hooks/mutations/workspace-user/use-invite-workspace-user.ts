import { useMutation } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import queryClient from "@/query-client";

type InviteWorkspaceUserRequest = {
  workspaceId: string;
  email: string;
  role: "viewer" | "member" | "admin" | "global-admin" | "owner";
  resend?: boolean;
};

function useInviteWorkspaceUser() {
  return useMutation({
    mutationFn: async ({
      workspaceId,
      email,
      role,
      resend,
    }: InviteWorkspaceUserRequest) => {
      const { data, error } = await authClient.organization.inviteMember({
        email,
        // Dynamic roles (viewer/global-admin) are valid at runtime but not in
        // better-auth's static role union.
        role: role as "member",
        organizationId: workspaceId,
        resend,
      });

      if (error) {
        throw new Error(error.message || "Failed to invite workspace member");
      }

      return data;
    },
    onSuccess: (_, { workspaceId }) => {
      queryClient.invalidateQueries({
        queryKey: ["workspace-invites", workspaceId],
      });

      queryClient.invalidateQueries({
        queryKey: ["workspace", "full", workspaceId],
      });

      queryClient.invalidateQueries({
        queryKey: ["workspace-users", workspaceId],
      });
    },
  });
}

export default useInviteWorkspaceUser;
