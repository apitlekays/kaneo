import { HTTPException } from "hono/http-exception";
import { isGlobalAdmin } from "../utils/project-access";

/**
 * "GM Admin" = configuration authority for the General Management module.
 * For now this maps to the workspace owner/global-admin (or instance admin);
 * the finer correspondence roles (registry/approver/signatory/records-manager/
 * auditor) arrive with the workflows that need them in later blocks.
 */
export async function isGmAdmin(userId: string, workspaceId: string) {
  return isGlobalAdmin(userId, workspaceId);
}

export async function assertGmAdmin(userId: string, workspaceId: string) {
  if (!(await isGmAdmin(userId, workspaceId))) {
    throw new HTTPException(403, {
      message: "General Management admin permission required",
    });
  }
}
