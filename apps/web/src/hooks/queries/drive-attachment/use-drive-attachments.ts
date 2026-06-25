import { useQuery } from "@tanstack/react-query";
import { getDriveAttachments } from "@/fetchers/drive-attachment";

export function useDriveAttachments(taskId: string) {
  return useQuery({
    queryKey: ["drive-attachments", taskId],
    queryFn: () => getDriveAttachments(taskId),
    enabled: !!taskId,
  });
}
