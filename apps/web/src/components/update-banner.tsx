import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { startUpdateChecks, useUpdateReady } from "@/lib/app-update";

/**
 * Shown across the top of the app once a newer build has been deployed and
 * already downloaded in the background. Updating is a reload, so it waits
 * for the person to choose the moment rather than discarding a half-typed
 * form. It floats over the page rather than pushing it down: the sidebar
 * is fixed at full viewport height and would otherwise cover it.
 */
export function UpdateBanner() {
  const ready = useUpdateReady();
  useEffect(() => startUpdateChecks(), []);

  if (!ready) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-[60] flex justify-center px-4">
      <div
        role="status"
        className="pointer-events-auto flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-lg border border-border bg-popover px-4 py-2 text-popover-foreground text-sm shadow-lg"
      >
        <span>A new version of MAPIMCore is available.</span>
        <Button size="xs" onClick={() => window.location.reload()}>
          <RefreshCw className="h-3.5 w-3.5" />
          Update
        </Button>
      </div>
    </div>
  );
}
