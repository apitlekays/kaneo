import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Calendar, Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  disconnectCalendar,
  getCalendarConnectUrl,
} from "@/fetchers/google-calendar";
import { useCalendarConnection } from "@/hooks/queries/google-calendar/use-calendar-connection";
import { toast } from "@/lib/toast";

type ConnectionsSearch = { google?: "connected" | "error" };

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/account/connections",
)({
  validateSearch: (search: Record<string, unknown>): ConnectionsSearch => ({
    google:
      search.google === "connected" || search.google === "error"
        ? search.google
        : undefined,
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { google } = Route.useSearch();
  const { data: status, isLoading } = useCalendarConnection();
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Surface the OAuth callback result, then clear it from the URL.
  useEffect(() => {
    if (!google) return;
    if (google === "connected") {
      toast.success(t("settings:connections.toastConnected"));
    } else {
      toast.error(t("settings:connections.toastError"));
    }
    queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
    navigate({ to: ".", search: {}, replace: true });
  }, [google, navigate, queryClient, t]);

  const handleConnect = () => {
    window.location.href = getCalendarConnectUrl();
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await disconnectCalendar();
      await queryClient.invalidateQueries({
        queryKey: ["google-calendar-status"],
      });
      toast.success(t("settings:connections.toastDisconnected"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:connections.toastDisconnectError"),
      );
    } finally {
      setIsDisconnecting(false);
    }
  };

  const connected = Boolean(status?.connected);
  const configured = status?.configured !== false;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">
          {t("settings:connections.title")}
        </h1>
        <p className="text-muted-foreground">
          {t("settings:connections.subtitle")}
        </p>
      </div>

      <div className="rounded-lg border p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted/40">
              <Calendar className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium">
                  {t("settings:connections.googleCalendar.title")}
                </h2>
                {connected && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    <Check className="h-3 w-3" />
                    {t("settings:connections.googleCalendar.connected")}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground max-w-md">
                {t("settings:connections.googleCalendar.description")}
              </p>
              {connected && status?.email && (
                <p className="text-xs text-muted-foreground">
                  {t("settings:connections.googleCalendar.connectedAs", {
                    email: status.email,
                  })}
                </p>
              )}
              {!configured && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {t("settings:connections.googleCalendar.notConfigured")}
                </p>
              )}
            </div>
          </div>

          <div className="shrink-0">
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : connected ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisconnect}
                disabled={isDisconnecting}
              >
                {isDisconnecting && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                {t("settings:connections.googleCalendar.disconnect")}
              </Button>
            ) : (
              <Button size="sm" onClick={handleConnect} disabled={!configured}>
                {t("settings:connections.googleCalendar.connect")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
