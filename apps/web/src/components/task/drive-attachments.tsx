import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileText, Loader2, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  addDriveAttachment,
  deleteDriveAttachment,
} from "@/fetchers/drive-attachment";
import useGetConfig from "@/hooks/queries/config/use-get-config";
import { useDriveAttachments } from "@/hooks/queries/drive-attachment/use-drive-attachments";
import { pickDriveFiles } from "@/lib/google-drive-picker";
import { loadDriveThumbnails } from "@/lib/google-drive-thumbnails";
import { toast } from "@/lib/toast";

type DriveAttachmentsProps = {
  taskId: string | undefined;
};

export default function DriveAttachments({ taskId }: DriveAttachmentsProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: config } = useGetConfig();
  const { data: attachments = [] } = useDriveAttachments(taskId ?? "");
  const [isPicking, setIsPicking] = useState(false);
  // fileId → thumbnail object URL (or null = no thumbnail; undefined = pending).
  const [thumbnails, setThumbnails] = useState<Record<string, string | null>>(
    {},
  );

  const clientId = config?.googleClientId ?? null;
  const apiKey = config?.googleDrivePickerApiKey ?? null;
  const canAttach = Boolean(taskId && clientId && apiKey);

  // Memoized so the loader effect only re-runs when the set of files changes,
  // not on every unrelated re-render.
  const fileIds = useMemo(
    () => attachments.map((a) => a.fileId),
    [attachments],
  );

  useEffect(() => {
    if (!clientId || fileIds.length === 0) return;
    let cancelled = false;
    void loadDriveThumbnails(clientId, fileIds, (fileId, url) => {
      if (!cancelled) {
        setThumbnails((prev) => ({ ...prev, [fileId]: url }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [clientId, fileIds]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["drive-attachments", taskId] });

  const handleAttach = async () => {
    if (!taskId || !clientId || !apiKey) return;
    setIsPicking(true);
    try {
      const files = await pickDriveFiles({ clientId, apiKey });
      for (const file of files) {
        await addDriveAttachment(taskId, {
          fileId: file.id,
          name: file.name,
          url: file.url,
          iconUrl: file.iconUrl ?? null,
          mimeType: file.mimeType ?? null,
        });
      }
      if (files.length > 0) {
        await invalidate();
        toast.success(t("tasks:driveAttachments.addSuccess"));
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:driveAttachments.addError"),
      );
    } finally {
      setIsPicking(false);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await deleteDriveAttachment(id);
      await invalidate();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:driveAttachments.removeError"),
      );
    }
  };

  if (!canAttach && attachments.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground/90">
          {t("tasks:driveAttachments.title")}
        </h2>
        {canAttach && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={handleAttach}
            disabled={isPicking}
          >
            {isPicking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            {t("tasks:driveAttachments.attach")}
          </Button>
        )}
      </div>

      {attachments.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {attachments.map((attachment) => {
            const thumb = thumbnails[attachment.fileId];
            return (
              <div
                key={attachment.id}
                className="group relative flex flex-col overflow-hidden rounded-lg border border-border/60 bg-card"
              >
                <a
                  href={attachment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={t("tasks:driveAttachments.openInDrive")}
                  className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted/40"
                >
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={attachment.name}
                      loading="lazy"
                      className="h-full w-full object-cover object-top"
                    />
                  ) : attachment.iconUrl ? (
                    <img
                      src={attachment.iconUrl}
                      alt=""
                      className="h-8 w-8 opacity-80"
                    />
                  ) : (
                    <FileText className="h-8 w-8 text-muted-foreground" />
                  )}
                </a>

                <div className="flex items-center gap-1.5 px-2 py-1.5">
                  {attachment.iconUrl ? (
                    <img
                      src={attachment.iconUrl}
                      alt=""
                      className="h-3.5 w-3.5 shrink-0"
                    />
                  ) : (
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <a
                    href={attachment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 truncate text-xs text-foreground hover:underline"
                    title={attachment.name}
                  >
                    {attachment.name}
                  </a>
                  <a
                    href={attachment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    title={t("tasks:driveAttachments.openInDrive")}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

                <button
                  type="button"
                  onClick={() => handleRemove(attachment.id)}
                  className="absolute right-1 top-1 rounded-full bg-background/80 p-1 text-muted-foreground opacity-0 backdrop-blur-sm transition-opacity hover:text-destructive group-hover:opacity-100"
                  title={t("tasks:driveAttachments.remove")}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
