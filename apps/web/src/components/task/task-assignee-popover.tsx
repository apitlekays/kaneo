import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import type Task from "@/types/task";
import { AssigneeMultiSelect } from "./assignee-multi-select";

type TaskAssigneePopoverProps = {
  task: Task;
  workspaceId: string;
  children: React.ReactNode;
};

export default function TaskAssigneePopover({
  task,
  workspaceId,
  children,
}: TaskAssigneePopoverProps) {
  const [open, setOpen] = useState(false);
  const { canAssignTasks } = useWorkspacePermission();

  if (!canAssignTasks()) return <>{children}</>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <AssigneeMultiSelect
          tasks={[task]}
          workspaceId={workspaceId}
          open={open}
        />
      </PopoverContent>
    </Popover>
  );
}
