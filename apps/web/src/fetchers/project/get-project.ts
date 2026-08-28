import { client } from "@kaneo/libs";
import type { InferRequestType } from "hono/client";

export type GetProjectRequest = InferRequestType<
  (typeof client)["project"][":id"]["$get"]
>["param"] & {
  // The API also derives the workspace from the project id itself (see
  // `workspaceAccess.fromProject()`, which lists the `workspaceId` query
  // param first and falls back to looking up the project), so sending it
  // here is redundant, not required. Callers still pass it through for
  // their own cache keys. One real consequence: for a missing or deleted
  // project id, the middleware now throws 400 "Workspace ID could not be
  // determined" where the controller previously threw 404 "Project not
  // found". Nothing in apps/web currently branches on that status/message.
  workspaceId: string;
};

async function getProject({ id }: GetProjectRequest) {
  const response = await client.project[":id"].$get({
    param: { id },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  const data = await response.json();

  return data;
}

export default getProject;
