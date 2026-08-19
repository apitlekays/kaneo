import { useMutation, useQueryClient } from "@tanstack/react-query";
import markAllNotificationsAsRead from "@/fetchers/notification/mark-all-notifications-as-read";

function useMarkAllNotificationsAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: markAllNotificationsAsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      // The Home activity feed reads the same rows under its own key.
      queryClient.invalidateQueries({ queryKey: ["notification-feed"] });
    },
  });
}

export default useMarkAllNotificationsAsRead;
