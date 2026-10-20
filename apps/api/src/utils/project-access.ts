import { and, eq, inArray } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
// These aren't part of the curated `schema` object passed to drizzle, so
// import them directly from the schema module.
import {
  activityTable,
  columnTable,
  commentTable,
  labelTable,
  projectMemberTable,
  taskDriveAttachmentTable,
  taskRelationTable,
  timeEntryTable,
  workflowRuleTable,
  workspacePageAccessTable,
} from "../database/schema";
import { hasWorkspacePermission } from "./require-workspace-permission";

/**
 * Per-project access control.
 *
 * Visibility/access is project-scoped: only project members can access a
 * project's data. Workspace owners/admins (and instance admins) are "global
 * admins" who bypass project membership entirely.
 *
 * The workspace role is a ceiling on the project role: a project member or
 * manager whose workspace role lacks `task:update` (the Viewer role) can read
 * the project but change nothing in it.
 */

type PermissionMap = Record<string, string[]>;

/** The workspace permission that lets a project member change things. */
const PROJECT_WRITE_PERMISSION: PermissionMap = { task: ["update"] };

/** Creating tasks needs `task:create` rather than `task:update`. */
export const TASK_CREATE_PERMISSION: PermissionMap = { task: ["create"] };

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

export const PROJECT_KIND = "project";
export const CONSULTATION_KIND = "consultation";
/** The access-matrix page that gates every consultation. */
export const CONSULTATIONS_PAGE = "consultations";

/**
 * Of `projectIds`, the consultations this user holds no Consultations page
 * grant for in that consultation's workspace.
 *
 * A consultation membership without the grant is DORMANT: it confers
 * nothing. Applying that here, beneath `getProjectRole` and
 * `getMemberProjectIds`, means every project-scoped route, list, search
 * and pending-decision feed inherits it without knowing consultations
 * exist. Global admins never reach this; every caller checks them first.
 */
export async function ungrantedConsultationIds(
  userId: string,
  projectIds: string[],
): Promise<Set<string>> {
  if (projectIds.length === 0) return new Set();
  const rows = await db
    .select({
      id: schema.projectTable.id,
      grant: workspacePageAccessTable.id,
    })
    .from(schema.projectTable)
    .leftJoin(
      workspacePageAccessTable,
      and(
        eq(
          workspacePageAccessTable.workspaceId,
          schema.projectTable.workspaceId,
        ),
        eq(workspacePageAccessTable.userId, userId),
        eq(workspacePageAccessTable.pageSlug, CONSULTATIONS_PAGE),
      ),
    )
    .where(
      and(
        inArray(schema.projectTable.id, projectIds),
        eq(schema.projectTable.kind, CONSULTATION_KIND),
      ),
    );
  return new Set(rows.filter((r) => !r.grant).map((r) => r.id));
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
  if (!member) return null;
  if ((await ungrantedConsultationIds(userId, [projectId])).has(projectId))
    return null;
  return member.role;
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
  const ids = rows.map((r) => r.projectId);
  const dormant = await ungrantedConsultationIds(userId, ids);
  return ids.filter((id) => !dormant.has(id));
}

export async function canAccessProject(
  userId: string,
  projectId: string,
  workspaceId: string,
): Promise<boolean> {
  if (await isGlobalAdmin(userId, workspaceId)) return true;
  return (await getProjectRole(userId, projectId)) !== null;
}

/** A project member (or global admin) whose workspace role is not read-only. */
export async function canWriteProject(
  userId: string,
  projectId: string,
  workspaceId: string,
  permission: PermissionMap = PROJECT_WRITE_PERMISSION,
): Promise<boolean> {
  if (await isGlobalAdmin(userId, workspaceId)) return true;
  if ((await getProjectRole(userId, projectId)) === null) return false;
  return hasWorkspacePermission(userId, workspaceId, permission);
}

/**
 * Who runs a project: a global admin, or a manager (Lead Consultant) or the
 * project's creator, still in the project and with a workspace role that is
 * not read-only. They edit the project's details ribbon, its people
 * (including who the managers are) and anyone's cost entries.
 */
export async function canManageProjectMembers(
  userId: string,
  projectId: string,
  workspaceId: string,
): Promise<boolean> {
  if (await isGlobalAdmin(userId, workspaceId)) return true;
  const role = await getProjectRole(userId, projectId);
  if (role === null) return false;
  if (role !== "manager") {
    const [project] = await db
      .select({ createdBy: schema.projectTable.createdBy })
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, projectId))
      .limit(1);
    if (project?.createdBy !== userId) return false;
  }
  return hasWorkspacePermission(userId, workspaceId, PROJECT_WRITE_PERMISSION);
}

/**
 * Deleting a task: its creator, or a project manager / global admin. Tasks
 * created before `created_by` existed (or by an integration) have no creator,
 * so only managers can delete them.
 */
export async function canDeleteTask(
  userId: string,
  task: { projectId: string; createdBy: string | null },
  workspaceId: string,
): Promise<boolean> {
  if (await canManageProjectMembers(userId, task.projectId, workspaceId)) {
    return true;
  }
  if (task.createdBy !== userId) return false;
  return canWriteProject(userId, task.projectId, workspaceId);
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

async function resolveProjectFromTask(taskId: string): Promise<ProjectContext> {
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
  return row ?? null;
}

/** Require Project Manager (or global admin) for a route keyed by a task id. */
export function requireProjectManagerFromTask(idKey = "id") {
  return projectManagerGuard((c) => {
    const id = c.req.param(idKey);
    return id ? resolveProjectFromTask(id) : Promise.resolve(null);
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

type TaskForAccess = {
  id: string;
  projectId: string;
  workspaceId: string;
  createdBy: string | null;
  assigneeId: string | null;
};

async function loadTaskForAccess(taskId: string): Promise<TaskForAccess> {
  const [row] = await db
    .select({
      id: schema.taskTable.id,
      projectId: schema.taskTable.projectId,
      workspaceId: schema.projectTable.workspaceId,
      createdBy: schema.taskTable.createdBy,
      assigneeId: schema.taskTable.userId,
    })
    .from(schema.taskTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.taskTable.projectId, schema.projectTable.id),
    )
    .where(eq(schema.taskTable.id, taskId))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Task not found" });
  return row;
}

async function isTaskAssignee(
  userId: string,
  task: TaskForAccess,
): Promise<boolean> {
  if (task.assigneeId === userId) return true;
  const [row] = await db
    .select({ id: schema.taskAssigneeTable.id })
    .from(schema.taskAssigneeTable)
    .where(
      and(
        eq(schema.taskAssigneeTable.taskId, task.id),
        eq(schema.taskAssigneeTable.userId, userId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Changing a task's status (moving its card between columns, or to another
 * project): its creator, anyone assigned to it, or a project manager / global
 * admin. Other project members can edit the task but not move it.
 */
async function canMoveTask(
  userId: string,
  task: TaskForAccess,
): Promise<boolean> {
  if (await canManageProjectMembers(userId, task.projectId, task.workspaceId)) {
    return true;
  }
  if (!(await canWriteProject(userId, task.projectId, task.workspaceId))) {
    return false;
  }
  if (task.createdBy === userId) return true;
  return isTaskAssignee(userId, task);
}

export const MOVE_TASK_FORBIDDEN_MESSAGE =
  "Only the task's creator, its assignees or a project manager can move this task";

export async function assertCanMoveTask(
  userId: string,
  taskId: string,
): Promise<void> {
  const task = await loadTaskForAccess(taskId);
  if (!(await canMoveTask(userId, task))) {
    throw new HTTPException(403, { message: MOVE_TASK_FORBIDDEN_MESSAGE });
  }
}

export async function assertCanDeleteTask(
  userId: string,
  taskId: string,
): Promise<void> {
  const task = await loadTaskForAccess(taskId);
  if (!(await canDeleteTask(userId, task, task.workspaceId))) {
    throw new HTTPException(403, {
      message:
        "Only the task's creator or a project manager can delete this task",
    });
  }
}

/** Assert the user can write in the project a task is being moved into. */
export async function assertCanWriteProjectById(
  userId: string,
  projectId: string,
): Promise<void> {
  const [project] = await db
    .select({ workspaceId: schema.projectTable.workspaceId })
    .from(schema.projectTable)
    .where(eq(schema.projectTable.id, projectId))
    .limit(1);
  if (!project) throw new HTTPException(404, { message: "Project not found" });
  if (!(await canWriteProject(userId, projectId, project.workspaceId))) {
    throw new HTTPException(403, {
      message: "You can't add tasks to that project",
    });
  }
}

/** Assert the user can write in the project of every given task. */
export async function assertCanWriteTasks(
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
    if (!(await canWriteProject(userId, row.projectId, row.workspaceId))) {
      throw new HTTPException(403, {
        message: "You can't change tasks in one of these projects",
      });
    }
  }
}

/** Assert the user manages the project of every given task. */
export async function assertCanManageTasks(
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
    if (
      !(await canManageProjectMembers(userId, row.projectId, row.workspaceId))
    ) {
      throw new HTTPException(403, {
        message: "Only project managers can assign tasks",
      });
    }
  }
}

type ProjectResource =
  | "project"
  | "task"
  | "comment"
  | "activity"
  | "timeEntry"
  | "taskRelation"
  | "driveAttachment"
  | "label";

async function lookupProjectContext(
  resource: ProjectResource,
  id: string,
): Promise<ProjectContext> {
  const viaTask = async (taskId: string | null | undefined) =>
    taskId ? resolveProjectFromTask(taskId) : null;

  switch (resource) {
    case "project": {
      const [row] = await db
        .select({
          projectId: schema.projectTable.id,
          workspaceId: schema.projectTable.workspaceId,
        })
        .from(schema.projectTable)
        .where(eq(schema.projectTable.id, id))
        .limit(1);
      return row ?? null;
    }
    case "task":
      return resolveProjectFromTask(id);
    case "comment": {
      const [row] = await db
        .select({ taskId: commentTable.taskId })
        .from(commentTable)
        .where(eq(commentTable.id, id))
        .limit(1);
      return viaTask(row?.taskId);
    }
    case "activity": {
      const [row] = await db
        .select({ taskId: activityTable.taskId })
        .from(activityTable)
        .where(eq(activityTable.id, id))
        .limit(1);
      return viaTask(row?.taskId);
    }
    case "timeEntry": {
      const [row] = await db
        .select({ taskId: timeEntryTable.taskId })
        .from(timeEntryTable)
        .where(eq(timeEntryTable.id, id))
        .limit(1);
      return viaTask(row?.taskId);
    }
    case "taskRelation": {
      const [row] = await db
        .select({ taskId: taskRelationTable.sourceTaskId })
        .from(taskRelationTable)
        .where(eq(taskRelationTable.id, id))
        .limit(1);
      return viaTask(row?.taskId);
    }
    case "driveAttachment": {
      const [row] = await db
        .select({ taskId: taskDriveAttachmentTable.taskId })
        .from(taskDriveAttachmentTable)
        .where(eq(taskDriveAttachmentTable.id, id))
        .limit(1);
      return viaTask(row?.taskId);
    }
    case "label": {
      const [row] = await db
        .select({ taskId: labelTable.taskId })
        .from(labelTable)
        .where(eq(labelTable.id, id))
        .limit(1);
      return viaTask(row?.taskId);
    }
  }
}

async function readIdFromRequest(
  c: Context,
  idKey: string,
): Promise<string | null> {
  const fromUrl = c.req.param(idKey) || c.req.query(idKey);
  if (fromUrl) return fromUrl;
  const body = await c.req.json().catch(() => null);
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const value = (body as Record<string, unknown>)[idKey];
    if (typeof value === "string") return value;
  }
  return null;
}

function projectGuard(
  mode: "read" | "write",
  resource: ProjectResource,
  idKey: string,
  permission?: PermissionMap,
) {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId");
    if (!userId) throw new HTTPException(401, { message: "Unauthorized" });

    const id = await readIdFromRequest(c, idKey);
    if (!id) {
      throw new HTTPException(400, { message: "Missing project context" });
    }

    const ctx = await lookupProjectContext(resource, id);
    if (!ctx) throw new HTTPException(404, { message: "Not found" });

    if (!(await canAccessProject(userId, ctx.projectId, ctx.workspaceId))) {
      throw new HTTPException(403, {
        message: "You don't have access to this project",
      });
    }
    if (
      mode === "write" &&
      !(await canWriteProject(
        userId,
        ctx.projectId,
        ctx.workspaceId,
        permission,
      ))
    ) {
      throw new HTTPException(403, {
        message: "Your role can only view this project",
      });
    }
    return next();
  };
}

/**
 * Route guards keyed by any project-scoped resource. `read` needs project
 * membership (or global admin); `write` also needs a workspace role that is
 * not read-only. The id is read from the route param, query or JSON body.
 */
export const projectAccess = {
  read: (resource: ProjectResource, idKey = "id") =>
    projectGuard("read", resource, idKey),
  write: (
    resource: ProjectResource,
    idKey = "id",
    permission?: PermissionMap,
  ) => projectGuard("write", resource, idKey, permission),
};
