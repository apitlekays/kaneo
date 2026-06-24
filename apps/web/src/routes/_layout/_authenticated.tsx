import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useUserWebSocket } from "@/hooks/use-user-websocket";
import { authClient } from "@/lib/auth-client";

// protects all child routes, must be logged in
export const Route = createFileRoute("/_layout/_authenticated")({
  beforeLoad: async ({ location }) => {
    const { data: session } = await authClient.getSession();
    if (!session) {
      throw redirect({
        to: "/auth/sign-in",
        search: {
          redirect: location.pathname,
        },
      });
    }
    return { session };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  useUserWebSocket();
  return <Outlet />;
}
