import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileText, Loader2, Plus, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  addDriveAttachment,
  deleteDriveAttachment,
} from "@/fetchers/drive-attachment";
import useGetConfig from "@/hooks/queries/config/use-get-config";
import { useDriveAttachments } from "@/hooks/queries/drive-attachment/use-drive-attachments";
import { pickDriveFiles } from "@/lib/google-drive-picker";
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

  const clientId = config?.googleClientId ?? null;
  const apiKey = config?.googleDrivePickerApiKey ?? null;
  const canAttach = Boolean(taskId && clientId && apiKey);

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
        <div className="flex flex-col gap-1">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="group flex items-center gap-2 rounded-md border border-border/60 px-2.5 py-1.5"
            >
              {attachment.iconUrl ? (
                <img
                  src={attachment.iconUrl}
                  alt=""
                  className="h-4 w-4 shrink-0"
                />
              ) : (
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <a
                href={attachment.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 min-w-0 truncate text-sm text-foreground hover:underline"
                title={attachment.name}
              >
                {attachment.name}
              </a>
              <a
                href={attachment.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground"
                title={t("tasks:driveAttachments.openInDrive")}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <button
                type="button"
                onClick={() => handleRemove(attachment.id)}
                className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                title={t("tasks:driveAttachments.remove")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
