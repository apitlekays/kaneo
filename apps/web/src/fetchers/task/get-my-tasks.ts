import { client } from "@kaneo/libs";

async function getMyTasks(workspaceId: string) {
  const response = await client.task["my-tasks"].$get({
    query: { workspaceId },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  const json = await response.json();

  return json.data;
}

export default getMyTasks;
