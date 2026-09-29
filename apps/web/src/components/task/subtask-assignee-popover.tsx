import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import type Task from "@/types/task";
import { AssigneeMultiSelect } from "./assignee-multi-select";

type SubtaskAssigneePopoverProps = {
  /** Every selected subtask; a pick applies to all of them. */
  tasks: Task[];
  workspaceId: string;
  children: React.ReactNode;
};

export default function SubtaskAssigneePopover({
  tasks,
  workspaceId,
  children,
}: SubtaskAssigneePopoverProps) {
  const [open, setOpen] = useState(false);
  const { canAssignTasks } = useWorkspacePermission();

  if (!canAssignTasks()) return <>{children}</>;

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <AssigneeMultiSelect
          tasks={tasks}
          workspaceId={workspaceId}
          open={open}
        />
      </PopoverContent>
    </Popover>
  );
}
