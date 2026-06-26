import { Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ColoredAvatar } from "@/components/ui/colored-avatar";
import type { NotificationFeedItem } from "@/fetchers/notification/get-feed";
import useMarkNotificationAsRead from "@/hooks/mutations/notification/use-mark-notification-as-read";
import { useNotificationFeed } from "@/hooks/queries/notification/use-notification-feed";

const VERB_KEY: Record<NotificationFeedItem["type"], string> = {
  task_tagged: "home:feed.verbs.tagged",
  task_assignee_changed: "home:feed.verbs.assigned",
  task_status_changed: "home:feed.verbs.status",
  task_commented: "home:feed.verbs.commented",
};

export default function HomeActivityFeed() {
  const { t } = useTranslation();
  const { data: items = [] } = useNotificationFeed();
  const { mutate: markRead } = useMarkNotificationAsRead();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <Bell className="h-4 w-4 shrink-0 text-muted-foreground" />
        <h2 className="text-sm font-medium text-foreground/95">
          {t("home:feed.title")}
        </h2>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
          {t("home:feed.empty")}
        </div>
      ) : (
        <div className="rounded-lg border divide-y divide-border/50">
          {items.map((item) => {
            const actor = item.eventData?.actorName ?? t("home:feed.someone");
            return (
              <Link
                key={item.id}
                to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
                params={{
                  workspaceId: item.workspaceId,
                  projectId: item.projectId,
                  taskId: item.taskId,
                }}
                onClick={() => {
                  if (!item.isRead) markRead(item.id);
                }}
                className="flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-accent/40"
              >
                <ColoredAvatar
                  name={actor}
                  seed={actor}
                  className="mt-0.5 h-6 w-6"
                  fallbackClassName="text-[10px]"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs leading-relaxed text-foreground/90">
                    <span className="font-medium">{actor}</span>{" "}
                    {t(VERB_KEY[item.type])}{" "}
                    <span className="font-medium text-foreground underline-offset-2 hover:underline">
                      {item.taskTitle}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {formatDistanceToNow(new Date(item.createdAt), {
                      addSuffix: true,
                    })}
                  </p>
                </div>
                {!item.isRead && (
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
