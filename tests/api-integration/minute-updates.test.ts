import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceMember,
  grantGeneralManagement,
} from "./helpers/fixtures";

// The presign route calls into the S3 presigner, which only computes a
// signature locally — it never contacts the endpoint. Fake, stable
// credentials are enough for it to run in the integration environment,
// which otherwise leaves S3 unconfigured.
process.env.S3_ENDPOINT ||= "http://localhost:9000";
process.env.S3_BUCKET ||= "kaneo-test-bucket";
process.env.S3_ACCESS_KEY_ID ||= "test-access-key";
process.env.S3_SECRET_ACCESS_KEY ||= "test-secret-key";

async function captureLetter(
  app: ReturnType<typeof createApp>["app"],
  workspaceId: string,
) {
  const response = await app.request("/api/correspondence/letters", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      direction: "in",
      type: "external",
      medium: "email",
      subject: "Ujian benang kemas kini",
    }),
  });
  return response.json();
}

/**
 * A letter with a delegated action assigned to `assignee`, minuted by the
 * workspace owner (who bypasses the general-management page-access gate).
 */
async function seedDelegatedAction(
  officer: Awaited<ReturnType<typeof createWorkspaceMember>>,
  assignee: Awaited<ReturnType<typeof createWorkspaceMember>>,
) {
  await db.insert(schema.workspaceUserTable).values({
    workspaceId: officer.workspace.id,
    userId: assignee.user.id,
    role: "member",
    joinedAt: new Date(),
  });

  mockAuthenticatedSession(officer.user);
  const { app } = createApp();
  const letter = await captureLetter(app, officer.workspace.id);

  const minuteResponse = await app.request(
    `/api/correspondence/letters/${letter.id}/minutes`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: officer.workspace.id,
        body: "Sila semak dan sahkan peruntukan",
        assigneeId: assignee.user.id,
      }),
    },
  );
  const minute = await minuteResponse.json();
  return { letter, minute };
}

function postUpdate(
  app: ReturnType<typeof createApp>["app"],
  letterId: string,
  minuteId: string,
  workspaceId: string,
  body: string,
) {
  return app.request(
    `/api/correspondence/letters/${letterId}/minutes/${minuteId}/updates`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, body }),
    },
  );
}

function presignAttachment(
  app: ReturnType<typeof createApp>["app"],
  letterId: string,
  workspaceId: string,
  minuteUpdateId?: string,
) {
  return app.request(
    `/api/correspondence/letters/${letterId}/attachments/presign`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        filename: "laporan.pdf",
        contentType: "application/pdf",
        ...(minuteUpdateId ? { minuteUpdateId } : {}),
      }),
    },
  );
}

function finalizeAttachment(
  app: ReturnType<typeof createApp>["app"],
  letterId: string,
  workspaceId: string,
  objectKey: string,
  minuteUpdateId?: string,
) {
  return app.request(
    `/api/correspondence/letters/${letterId}/attachments/finalize`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        objectKey,
        filename: "laporan.pdf",
        mimeType: "application/pdf",
        size: 1024,
        ...(minuteUpdateId ? { minuteUpdateId } : {}),
      }),
    },
  );
}

describe("API integration: minute update thread", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("lets the minute's assignee, with no GM page access, post an update", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    const assignee = await createWorkspaceMember({ role: "member" });
    const { letter, minute } = await seedDelegatedAction(officer, assignee);

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const response = await postUpdate(
      assigneeApp,
      letter.id,
      minute.id,
      officer.workspace.id,
      "Sudah hantar memo kepada jabatan kewangan",
    );
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created.body).toBe("Sudah hantar memo kepada jabatan kewangan");
    expect(created.authorId).toBe(assignee.user.id);

    const rows = await db
      .select()
      .from(schema.letterMinuteUpdateTable)
      .where(eq(schema.letterMinuteUpdateTable.minuteId, minute.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].authorId).toBe(assignee.user.id);
  });

  it("refuses an unrelated workspace member with no page access, and writes no row", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    const assignee = await createWorkspaceMember({ role: "member" });
    const { letter, minute } = await seedDelegatedAction(officer, assignee);

    const bystander = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: officer.workspace.id,
      userId: bystander.user.id,
      role: "member",
      joinedAt: new Date(),
    });

    mockAuthenticatedSession(bystander.user);
    const { app: bystanderApp } = createApp();
    const response = await postUpdate(
      bystanderApp,
      letter.id,
      minute.id,
      officer.workspace.id,
      "Saya nak campur tangan",
    );
    expect(response.status).toBe(403);

    const rows = await db
      .select()
      .from(schema.letterMinuteUpdateTable)
      .where(eq(schema.letterMinuteUpdateTable.minuteId, minute.id));
    expect(rows).toHaveLength(0);
  });

  it("lets a GM officer post on someone else's delegated action", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    const assignee = await createWorkspaceMember({ role: "member" });
    const { letter, minute } = await seedDelegatedAction(officer, assignee);

    const gmOfficer = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: officer.workspace.id,
      userId: gmOfficer.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    await grantGeneralManagement(officer.workspace.id, gmOfficer.user.id);

    mockAuthenticatedSession(gmOfficer.user);
    const { app: gmApp } = createApp();
    const response = await postUpdate(
      gmApp,
      letter.id,
      minute.id,
      officer.workspace.id,
      "GM menyemak status tindakan ini",
    );
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created.authorId).toBe(gmOfficer.user.id);
  });

  it("does not complete the action when posting an update", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    const assignee = await createWorkspaceMember({ role: "member" });
    const { letter, minute } = await seedDelegatedAction(officer, assignee);

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const response = await postUpdate(
      assigneeApp,
      letter.id,
      minute.id,
      officer.workspace.id,
      "Kerja sedang dijalankan",
    );
    expect(response.status).toBe(201);

    const [row] = await db
      .select()
      .from(schema.letterMinuteTable)
      .where(eq(schema.letterMinuteTable.id, minute.id));
    expect(row.status).toBe("open");
    expect(row.completedAt).toBeNull();
  });

  it("returns the letter detail's minutes with their updates, oldest-first", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    const assignee = await createWorkspaceMember({ role: "member" });
    const { letter, minute } = await seedDelegatedAction(officer, assignee);

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    await postUpdate(
      assigneeApp,
      letter.id,
      minute.id,
      officer.workspace.id,
      "Kemas kini pertama",
    );
    await postUpdate(
      assigneeApp,
      letter.id,
      minute.id,
      officer.workspace.id,
      "Kemas kini kedua",
    );

    mockAuthenticatedSession(officer.user);
    const { app: officerApp } = createApp();
    const detailResponse = await officerApp.request(
      `/api/correspondence/letters/${letter.id}?workspaceId=${officer.workspace.id}`,
    );
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json();

    const detailMinute = detail.minutes.find(
      (m: { id: string }) => m.id === minute.id,
    );
    expect(detailMinute).toBeDefined();
    expect(detailMinute.updates).toHaveLength(2);
    expect(detailMinute.updates[0].body).toBe("Kemas kini pertama");
    expect(detailMinute.updates[1].body).toBe("Kemas kini kedua");
  });

  it("lets a minute assignee with no page access presign and finalize an attachment on their own update", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    const assignee = await createWorkspaceMember({ role: "member" });
    const { letter, minute } = await seedDelegatedAction(officer, assignee);

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const updateResponse = await postUpdate(
      assigneeApp,
      letter.id,
      minute.id,
      officer.workspace.id,
      "Dokumen sokongan telah disediakan",
    );
    expect(updateResponse.status).toBe(201);
    const update = await updateResponse.json();

    const presignResponse = await presignAttachment(
      assigneeApp,
      letter.id,
      officer.workspace.id,
      update.id,
    );
    expect(presignResponse.status).toBe(200);
    const presigned = await presignResponse.json();
    expect(typeof presigned.key).toBe("string");

    const finalizeResponse = await finalizeAttachment(
      assigneeApp,
      letter.id,
      officer.workspace.id,
      presigned.key,
      update.id,
    );
    expect(finalizeResponse.status).toBe(201);
    const attachment = await finalizeResponse.json();
    expect(attachment.letterId).toBe(letter.id);
    expect(attachment.minuteUpdateId).toBe(update.id);
  });

  it("refuses that same assignee on the ordinary (no minuteUpdateId) path on both routes", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    const assignee = await createWorkspaceMember({ role: "member" });
    const { letter } = await seedDelegatedAction(officer, assignee);

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();

    const presignResponse = await presignAttachment(
      assigneeApp,
      letter.id,
      officer.workspace.id,
    );
    expect(presignResponse.status).toBe(403);

    const finalizeResponse = await finalizeAttachment(
      assigneeApp,
      letter.id,
      officer.workspace.id,
      `workspace/${officer.workspace.id}/letter/${letter.id}/laporan.pdf`,
    );
    expect(finalizeResponse.status).toBe(403);

    const rows = await db
      .select()
      .from(schema.letterAttachmentTable)
      .where(eq(schema.letterAttachmentTable.letterId, letter.id));
    expect(rows).toHaveLength(0);
  });

  it("404s finalizing with a minuteUpdateId that belongs to a different letter", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    const assignee = await createWorkspaceMember({ role: "member" });
    const { letter: letterA } = await seedDelegatedAction(officer, assignee);
    const { letter: letterB, minute: minuteB } = await seedDelegatedAction(
      officer,
      assignee,
    );

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const updateBResponse = await postUpdate(
      assigneeApp,
      letterB.id,
      minuteB.id,
      officer.workspace.id,
      "Kemas kini pada surat yang lain",
    );
    expect(updateBResponse.status).toBe(201);
    const updateB = await updateBResponse.json();

    const finalizeResponse = await finalizeAttachment(
      assigneeApp,
      letterA.id,
      officer.workspace.id,
      `workspace/${officer.workspace.id}/letter/${letterA.id}/laporan.pdf`,
      updateB.id,
    );
    expect(finalizeResponse.status).toBe(404);
  });
});
