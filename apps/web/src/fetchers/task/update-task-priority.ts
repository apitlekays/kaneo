import { client } from "@kaneo/libs";
import { toTaskPriority } from "@/lib/task-priority";
import type Task from "@/types/task";

async function updateTaskPriority(taskId: string, task: Task) {
  const response = await client.task.priority[":id"].$put({
    param: { id: taskId },
    json: {
      priority: toTaskPriority(task.priority),
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  const data = await response.json();

  return data;
}

export default updateTaskPriority;
