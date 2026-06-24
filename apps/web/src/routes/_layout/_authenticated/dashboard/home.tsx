import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { Calendar, CalendarClock, CalendarX, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import Layout from "@/components/common/layout";
import PageTitle from "@/components/page-title";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import icons from "@/constants/project-icons";
import { useMyTasks } from "@/hooks/queries/task/use-my-tasks";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { cn } from "@/lib/cn";
import { dueDateStatusColors, getDueDateStatus } from "@/lib/due-date-status";
import { getPriorityIcon } from "@/lib/priority";

export const Route = createFileRoute("/_layout/_authenticated/dashboard/home")({
  component: HomePage,
});

function HomePage() {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const { data, isLoading } = useMyTasks(workspace?.id ?? "");

  const projects = data?.projects ?? [];

  return (
    <>
      <PageTitle title={t("home:title")} />
      <Layout>
        <Layout.Header>
          <div className="flex items-center gap-1 w-full">
            <SidebarTrigger className="-ml-1 h-6 w-6" />
            <Separator
              orientation="vertical"
              className="mx-1.5 data-[orientation=vertical]:h-2.5"
            />
            <h1 className="text-xs text-card-foreground">{t("home:header")}</h1>
          </div>
        </Layout.Header>
        <Layout.Content>
          <div className="p-6 space-y-8 max-w-4xl mx-auto w-full">
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : projects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted/50 mb-4">
                  <Calendar className="h-8 w-8 text-muted-foreground/60" />
                </div>
                <h3 className="text-base font-semibold mb-2">
                  {t("home:empty.title")}
                </h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  {t("home:empty.description")}
                </p>
              </div>
            ) : (
              projects.map((project) => {
                const ProjectIcon =
                  icons[project.icon as keyof typeof icons] || icons.Layout;

                return (
                  <section key={project.id} className="space-y-2">
                    <div className="flex items-center gap-2 px-1">
                      <ProjectIcon className="h-4 w-4 text-muted-foreground" />
                      <h2 className="text-sm font-semibold text-foreground">
                        {project.name}
                      </h2>
                      <span className="text-xs text-muted-foreground">
                        {project.tasks.length}
                      </span>
                    </div>
                    <div className="rounded-lg border divide-y divide-border/50">
                      {project.tasks.map((task) => {
                        const dueStatus = getDueDateStatus(
                          task.dueDate
                            ? new Date(task.dueDate).toISOString()
                            : null,
                        );

                        return (
                          <Link
                            key={task.id}
                            to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
                            params={{
                              workspaceId: data?.workspaceId ?? "",
                              projectId: project.id,
                              taskId: task.id,
                            }}
                            className="group flex items-center gap-3 px-4 py-2 transition-colors hover:bg-accent/60"
                          >
                            <div className="flex-shrink-0 first:[&_svg]:h-4 first:[&_svg]:w-4">
                              {getPriorityIcon(task.priority ?? "")}
                            </div>
                            <div className="text-xs font-mono text-muted-foreground flex-shrink-0">
                              {project.slug}-{task.number}
                            </div>
                            <span className="flex-1 min-w-0 truncate text-sm text-foreground">
                              {task.title}
                            </span>
                            {task.labels.length > 0 && (
                              <div className="flex items-center gap-1 flex-shrink-0">
                                {task.labels.map((label) => (
                                  <span
                                    key={label.id}
                                    className="h-2 w-2 rounded-full"
                                    style={{ backgroundColor: label.color }}
                                    title={label.name}
                                  />
                                ))}
                              </div>
                            )}
                            {task.dueDate && (
                              <div
                                className={cn(
                                  "flex items-center gap-1 text-[10px] px-2 py-1 rounded flex-shrink-0",
                                  dueDateStatusColors[dueStatus],
                                )}
                              >
                                {dueStatus === "overdue" && (
                                  <CalendarX className="w-3 h-3" />
                                )}
                                {dueStatus === "due-soon" && (
                                  <CalendarClock className="w-3 h-3" />
                                )}
                                {(dueStatus === "far-future" ||
                                  dueStatus === "no-due-date") && (
                                  <Calendar className="w-3 h-3" />
                                )}
                                <span>
                                  {format(new Date(task.dueDate), "MMM d")}
                                </span>
                              </div>
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  </section>
                );
              })
            )}
          </div>
        </Layout.Content>
      </Layout>
    </>
  );
}
