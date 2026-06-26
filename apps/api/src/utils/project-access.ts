import { and, eq, inArray } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
// These aren't part of the curated `schema` object passed to drizzle, so
// import them directly from the schema module.
import {
  columnTable,
  projectMemberTable,
  workflowRuleTable,
} from "../database/schema";

/**
 * Per-project access control.
 *
 * Visibility/access is project-scoped: only project members can access a
 * project's data. Workspace owners/admins (and instance admins) are "global
 * admins" who bypass project membership entirely.
 */

export async function isInstanceAdminUser(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ role: schema.userTable.role })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId))
    .limit(1);
  return row?.role === "admin";
}

export async function getWorkspaceRole(
  userId: string,
  workspaceId: string,
): Promise<string | null> {
  const [member] = await db
    .select({ role: schema.workspaceUserTable.role })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.userId, userId),
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return member?.role ?? null;
}

// Workspace roles that grant global-admin powers (see/manage every project).
// `owner` is the SuperUser; `global-admin` is the dedicated role; `admin` is
// kept for backward compatibility until existing rows are migrated.
const GLOBAL_ADMIN_ROLES = new Set(["owner", "global-admin", "admin"]);

/** Workspace owner/global-admin (or instance admin) — sees and manages every project. */
export async function isGlobalAdmin(
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const role = await getWorkspaceRole(userId, workspaceId);
  if (role && GLOBAL_ADMIN_ROLES.has(role)) return true;
  return isInstanceAdminUser(userId);
}

export async function getProjectRole(
  userId: string,
  projectId: string,
): Promise<string | null> {
  const [member] = await db
    .select({ role: projectMemberTable.role })
    .from(projectMemberTable)
    .where(
      and(
        eq(projectMemberTable.userId, userId),
        eq(projectMemberTable.projectId, projectId),
      ),
    )
    .limit(1);
  return member?.role ?? null;
}

/** Project ids the user is an explicit member of (within a workspace). */
export async function getMemberProjectIds(
  userId: string,
  workspaceId: string,
): Promise<string[]> {
  const rows = await db
    .select({ projectId: projectMemberTable.projectId })
    .from(projectMemberTable)
    .innerJoin(
      schema.projectTable,
      eq(projectMemberTable.projectId, schema.projectTable.id),
    )
    .where(
      and(
        eq(projectMemberTable.userId, userId),
        eq(schema.projectTable.workspaceId, workspaceId),
      ),
    );
  return rows.map((r) => r.projectId);
}

export async function canAccessProject(
  userId: string,
  projectId: string,
  workspaceId: string,
): Promise<boolean> {
  if (await isGlobalAdmin(userId, workspaceId)) return true;
  return (await getProjectRole(userId, projectId)) !== null;
}

/** Creator/manager of the project, or a global admin. */
export async function canManageProjectMembers(
  userId: string,
  projectId: string,
  workspaceId: string,
): Promise<boolean> {
  if (await isGlobalAdmin(userId, workspaceId)) return true;
  return (await getProjectRole(userId, projectId)) === "manager";
}

/**
 * Middleware: require the current user to be able to access the project named
 * by `projectIdKey` (a route param). Run after `workspaceAccess.*`, which sets
 * `workspaceId` and validates workspace membership.
 */
export function requireProjectAccess(projectIdKey = "projectId") {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId");
    const workspaceId = c.get("workspaceId");
    const projectId = c.req.param(projectIdKey);

    if (!userId || !workspaceId || !projectId) {
      throw new HTTPException(400, { message: "Missing project context" });
    }

    if (!(await canAccessProject(userId, projectId, workspaceId))) {
      throw new HTTPException(403, {
        message: "You don't have access to this project",
      });
    }

    return next();
  };
}

/**
 * Middleware: require the user to be a Project Manager (or global admin) for the
 * project named by `projectIdKey`. Used to gate project-settings edits.
 */
export function requireProjectManager(projectIdKey = "id") {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId");
    const workspaceId = c.get("workspaceId");
    const projectId = c.req.param(projectIdKey);

    if (!userId || !workspaceId || !projectId) {
      throw new HTTPException(400, { message: "Missing project context" });
    }

    if (!(await canManageProjectMembers(userId, projectId, workspaceId))) {
      throw new HTTPException(403, {
        message: "Only project managers can change this project",
      });
    }

    return next();
  };
}

type ProjectContext = { projectId: string; workspaceId: string } | null;

async function resolveProjectFromColumn(
  columnId: string,
): Promise<ProjectContext> {
  const [row] = await db
    .select({
      projectId: columnTable.projectId,
      workspaceId: schema.projectTable.workspaceId,
    })
    .from(columnTable)
    .innerJoin(
      schema.projectTable,
      eq(columnTable.projectId, schema.projectTable.id),
    )
    .where(eq(columnTable.id, columnId))
    .limit(1);
  return row ?? null;
}

async function resolveProjectFromWorkflowRule(
  ruleId: string,
): Promise<ProjectContext> {
  const [row] = await db
    .select({
      projectId: workflowRuleTable.projectId,
      workspaceId: schema.projectTable.workspaceId,
    })
    .from(workflowRuleTable)
    .innerJoin(
      schema.projectTable,
      eq(workflowRuleTable.projectId, schema.projectTable.id),
    )
    .where(eq(workflowRuleTable.id, ruleId))
    .limit(1);
  return row ?? null;
}

function projectManagerGuard(resolve: (c: Context) => Promise<ProjectContext>) {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId");
    if (!userId) throw new HTTPException(401, { message: "Unauthorized" });

    const ctx = await resolve(c);
    if (!ctx) throw new HTTPException(404, { message: "Not found" });

    if (
      !(await canManageProjectMembers(userId, ctx.projectId, ctx.workspaceId))
    ) {
      throw new HTTPException(403, {
        message: "Only project managers can change this project",
      });
    }
    return next();
  };
}

/** Require Project Manager (or global admin) for a route keyed by a column id. */
export function requireProjectManagerFromColumn(idKey = "id") {
  return projectManagerGuard((c) => {
    const id = c.req.param(idKey);
    return id ? resolveProjectFromColumn(id) : Promise.resolve(null);
  });
}

/** Require Project Manager (or global admin) for a route keyed by a workflow-rule id. */
export function requireProjectManagerFromWorkflowRule(idKey = "id") {
  return projectManagerGuard((c) => {
    const id = c.req.param(idKey);
    return id ? resolveProjectFromWorkflowRule(id) : Promise.resolve(null);
  });
}

/**
 * Assert the user can access the project of every given task. Used by bulk task
 * routes (which span task ids that may live in different projects).
 */
export async function assertCanAccessTasks(
  userId: string,
  taskIds: string[],
): Promise<void> {
  if (taskIds.length === 0) return;
  const rows = await db
    .selectDistinct({
      projectId: schema.taskTable.projectId,
      workspaceId: schema.projectTable.workspaceId,
    })
    .from(schema.taskTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.taskTable.projectId, schema.projectTable.id),
    )
    .where(inArray(schema.taskTable.id, taskIds));

  for (const row of rows) {
    if (!(await canAccessProject(userId, row.projectId, row.workspaceId))) {
      throw new HTTPException(403, {
        message: "You don't have access to one of these tasks' projects",
      });
    }
  }
}

/**
 * Middleware: require project access for a route keyed by a task id (resolves
 * the task's project + workspace, then checks access). Defense-in-depth for
 * task mutation routes so a non-member can't act on a task by id alone.
 */
export function requireProjectAccessFromTask(taskIdKey = "id") {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId");
    const taskId = c.req.param(taskIdKey);

    if (!userId || !taskId) {
      throw new HTTPException(400, { message: "Missing task context" });
    }

    const [row] = await db
      .select({
        projectId: schema.taskTable.projectId,
        workspaceId: schema.projectTable.workspaceId,
      })
      .from(schema.taskTable)
      .innerJoin(
        schema.projectTable,
        eq(schema.taskTable.projectId, schema.projectTable.id),
      )
      .where(eq(schema.taskTable.id, taskId))
      .limit(1);

    if (!row) {
      throw new HTTPException(404, { message: "Task not found" });
    }

    if (!(await canAccessProject(userId, row.projectId, row.workspaceId))) {
      throw new HTTPException(403, {
        message: "You don't have access to this project",
      });
    }

    return next();
  };
}
