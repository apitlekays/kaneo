import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import db from "../../../apps/api/src/database";
import { settleBackgroundWork } from "../../../apps/api/src/utils/background-work";

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(currentDir, "../../../apps/api/drizzle");

let migrationPromise: Promise<void> | null = null;

function getDatabaseName(connectionString: string) {
  return new URL(connectionString).pathname.replace(/^\//, "");
}

function getAdminDatabaseUrl(connectionString: string) {
  const url = new URL(connectionString);
  url.pathname = "/postgres";
  return url.toString();
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function ensureTestDatabaseExists() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL must be defined for integration tests");
  }

  const databaseName = getDatabaseName(connectionString);

  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to manage non-test database "${databaseName}". DATABASE_URL must point to a test database.`,
    );
  }

  const adminClient = new Client({
    connectionString: getAdminDatabaseUrl(connectionString),
  });

  await adminClient.connect();

  try {
    const result = await adminClient.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [databaseName],
    );

    if (result.rowCount === 0) {
      await adminClient.query(
        `CREATE DATABASE ${quoteIdentifier(databaseName)}`,
      );
    }
  } finally {
    await adminClient.end();
  }
}

export async function ensureTestDatabaseMigrated() {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      await ensureTestDatabaseExists();
      await migrate(db, {
        migrationsFolder,
      });
    })();
  }

  try {
    await migrationPromise;
  } catch (error) {
    migrationPromise = null;
    throw error;
  }
}

export async function resetTestDatabase() {
  await ensureTestDatabaseMigrated();

  // publishEvent() is fire-and-forget: the previous test's request can
  // return while its event handlers (e.g. notification delivery) are still
  // running DB queries against these same tables. Racing that work against
  // the TRUNCATE below caused an intermittent deadlock — the handler's
  // SELECT took AccessShareLock on one relation while waiting on another
  // that TRUNCATE already held AccessExclusiveLock on, and vice versa.
  //
  // An earlier version of this fix only drained event-handler promises
  // (via `settlePendingEvents`). That missed the layer beneath them: a
  // handler can itself kick off further fire-and-forget work (e.g.
  // `createNotification` firing off `deliverNotification`, which runs its
  // own SELECT after the handler that started it has already resolved).
  // Draining handlers only let that inner work keep running, and it hit the
  // exact same deadlock one layer down. `settleBackgroundWork` drains a
  // single shared registry that every layer — event handlers and whatever
  // they kick off — reports into, so this now waits for *all* registered
  // background work, not just event handlers, before truncating.
  await settleBackgroundWork();

  await db.execute(
    sql.raw(`
      TRUNCATE TABLE
        "activity",
        "account",
        "apikey",
        "asset",
        "column",
        "comment",
        "external_link",
        "github_integration",
        "integration",
        "invitation",
        "label",
        "notification",
        "project",
        "session",
        "task",
        "task_relation",
        "team",
        "team_member",
        "time_entry",
        "verification",
        "workflow_rule",
        "workspace",
        "workspace_member",
        "user"
      RESTART IDENTITY CASCADE
    `),
  );
}
