import { client } from "@kaneo/libs";

async function unwrap(response: Response) {
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<{ status: string }>;
}

/** Adds someone alongside the current assignees (offers it to anyone else). */
export async function addTaskAssignee(taskId: string, userId: string) {
  return unwrap(
    await client.task[":id"].assignees.$post({
      param: { id: taskId },
      json: { userId },
    }),
  );
}

/** Takes someone off a task, or withdraws the offer waiting on them. */
export async function removeTaskAssignee(taskId: string, userId: string) {
  return unwrap(
    await client.task[":id"].assignees[":userId"].$delete({
      param: { id: taskId, userId },
    }),
  );
}

/** Makes an accepted assignee the lead. */
export async function setTaskLead(taskId: string, userId: string) {
  return unwrap(
    await client.task[":id"].lead.$put({
      param: { id: taskId },
      json: { userId },
    }),
  );
}
