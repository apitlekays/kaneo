import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceMember,
  grantGeneralManagement,
} from "./helpers/fixtures";

async function captureLetter(
  app: ReturnType<typeof createApp>["app"],
  workspaceId: string,
  subject: string,
) {
  const response = await app.request("/api/correspondence/letters", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      direction: "in",
      type: "external",
      medium: "email",
      subject,
    }),
  });
  return response.json();
}

function linkLetters(
  app: ReturnType<typeof createApp>["app"],
  workspaceId: string,
  fromLetterId: string,
  toLetterId: string,
) {
  return app.request(`/api/correspondence/letters/${fromLetterId}/links`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId, toLetterId }),
  });
}

describe("API integration: letter links", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  // I3: a self-link would show up in BOTH halves of the detail query
  // (outbound and inbound) — duplicate React key, the letter shown as
  // superseding itself, linkCount doubled — and there is no delete route
  // for a link to undo it once written.
  it("rejects a letter linking to itself with 400, and writes nothing", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    await grantGeneralManagement(officer.workspace.id, officer.user.id);
    mockAuthenticatedSession(officer.user);
    const { app } = createApp();

    const letter = await captureLetter(app, officer.workspace.id, "Letter A");

    const response = await linkLetters(
      app,
      officer.workspace.id,
      letter.id,
      letter.id,
    );

    expect(response.status).toBe(400);

    // No self-edge was written: the detail view's link list is empty, and
    // in particular does not contain the letter twice (once as outbound,
    // once as inbound), which is what an unrejected self-link would do.
    const detail = await app.request(
      `/api/correspondence/letters/${letter.id}?workspaceId=${officer.workspace.id}`,
    );
    const body = await detail.json();
    expect(body.links).toEqual([]);
  });

  it("still allows linking two different letters", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    await grantGeneralManagement(officer.workspace.id, officer.user.id);
    mockAuthenticatedSession(officer.user);
    const { app } = createApp();

    const letterA = await captureLetter(app, officer.workspace.id, "Letter A");
    const letterB = await captureLetter(app, officer.workspace.id, "Letter B");

    const response = await linkLetters(
      app,
      officer.workspace.id,
      letterA.id,
      letterB.id,
    );

    expect(response.status).toBe(201);
  });
});
