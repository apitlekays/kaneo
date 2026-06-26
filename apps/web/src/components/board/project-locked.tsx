import { Lock } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { requestProjectAccess } from "@/fetchers/project-member";
import { toast } from "@/lib/toast";

/** Shown when a workspace member opens a project they haven't been added to. */
export default function ProjectLocked({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [requested, setRequested] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleRequest = async () => {
    setBusy(true);
    try {
      await requestProjectAccess(projectId);
      setRequested(true);
      toast.success(t("tasks:projectLocked.requested"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:projectLocked.requestError"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted/50">
        <Lock className="h-8 w-8 text-muted-foreground/70" />
      </div>
      <div className="space-y-1">
        <h2 className="text-base font-semibold">
          {t("tasks:projectLocked.title")}
        </h2>
        <p className="max-w-md text-sm text-muted-foreground">
          {t("tasks:projectLocked.description")}
        </p>
      </div>
      <Button onClick={handleRequest} disabled={busy || requested} size="sm">
        {requested
          ? t("tasks:projectLocked.requestedShort")
          : t("tasks:projectLocked.requestAccess")}
      </Button>
    </div>
  );
}
