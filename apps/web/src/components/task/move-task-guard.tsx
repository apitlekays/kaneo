import { useCallback, useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import type Task from "@/types/task";

type MovableTask = Pick<Task, "createdBy" | "userId" | "assignees">;

/**
 * Gate for changing a task's status (dragging its card to another column,
 * picking a new status, moving it to another project). Only the task's
 * creator, its assignees and project managers may; anyone else gets a dialog
 * saying so instead of a silent failure. Render `dialog` once in the caller.
 *
 *   const { guardMove, dialog } = useMoveTaskGuard();
 *   if (!guardMove(task)) return;
 */
export function useMoveTaskGuard() {
  const { canMoveTask } = useWorkspacePermission();
  const [open, setOpen] = useState(false);

  const guardMove = useCallback(
    (task: MovableTask) => {
      if (canMoveTask(task)) return true;
      setOpen(true);
      return false;
    },
    [canMoveTask],
  );

  const dialog = (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>You can't move this task</AlertDialogTitle>
          <AlertDialogDescription>
            Only the task's creator, the people assigned to it, or a project
            manager can change its status or move it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button size="sm" onClick={() => setOpen(false)}>
            OK
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { guardMove, dialog };
}
