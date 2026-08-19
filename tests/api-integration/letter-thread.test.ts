import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
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
  receivedAt?: string,
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
      receivedAt,
    }),
  });
  return response.json();
}

async function linkLetters(
  app: ReturnType<typeof createApp>["app"],
  workspaceId: string,
  fromLetterId: string,
  toLetterId: string,
) {
  const response = await app.request(
    `/api/correspondence/letters/${fromLetterId}/links`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, toLetterId }),
    },
  );
  expect(response.status).toBe(201);
}

function getThread(
  app: ReturnType<typeof createApp>["app"],
  workspaceId: string,
  letterId: string,
) {
  return app.request(
    `/api/correspondence/letters/${letterId}/thread?workspaceId=${workspaceId}`,
  );
}

describe("API integration: letter thread", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("walks a chain A -> B -> C bidirectionally and orders it newest first", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    await grantGeneralManagement(officer.workspace.id, officer.user.id);
    mockAuthenticatedSession(officer.user);
    const { app } = createApp();

    const letterA = await captureLetter(
      app,
      officer.workspace.id,
      "Letter A",
      "2026-01-01T00:00:00.000Z",
    );
    const letterB = await captureLetter(
      app,
      officer.workspace.id,
      "Letter B",
      "2026-01-10T00:00:00.000Z",
    );
    const letterC = await captureLetter(
      app,
      officer.workspace.id,
      "Letter C",
      "2026-01-20T00:00:00.000Z",
    );

    await linkLetters(app, officer.workspace.id, letterA.id, letterB.id);
    await linkLetters(app, officer.workspace.id, letterB.id, letterC.id);

    // Case 1: opening the thread from the middle letter (B) returns all three,
    // newest first by date.
    const fromB = await getThread(app, officer.workspace.id, letterB.id);
    expect(fromB.status).toBe(200);
    const bodyFromB = await fromB.json();
    expect(bodyFromB.truncated).toBe(false);
    expect(bodyFromB.letters.map((l: { id: string }) => l.id)).toEqual([
      letterC.id,
      letterB.id,
      letterA.id,
    ]);
    const seedFromB = bodyFromB.letters.find(
      (l: { id: string; isSeed: boolean }) => l.id === letterB.id,
    );
    expect(seedFromB.isSeed).toBe(true);
    for (const other of [letterA.id, letterC.id]) {
      const entry = bodyFromB.letters.find(
        (l: { id: string; isSeed: boolean }) => l.id === other,
      );
      expect(entry.isSeed).toBe(false);
    }

    // Case 2: opening the thread from the far end (A) returns the same three
    // letters — the walk follows the A->B link backwards, proving it is
    // bidirectional through a real database, not just from the seed forwards.
    const fromA = await getThread(app, officer.workspace.id, letterA.id);
    expect(fromA.status).toBe(200);
    const bodyFromA = await fromA.json();
    expect(bodyFromA.truncated).toBe(false);
    expect(bodyFromA.letters.map((l: { id: string }) => l.id)).toEqual([
      letterC.id,
      letterB.id,
      letterA.id,
    ]);
    const seedFromA = bodyFromA.letters.find(
      (l: { id: string; isSeed: boolean }) => l.id === letterA.id,
    );
    expect(seedFromA.isSeed).toBe(true);
  });

  it("does not surface a letter linked in from a different workspace", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    await grantGeneralManagement(officer.workspace.id, officer.user.id);
    mockAuthenticatedSession(officer.user);
    const { app } = createApp();
    const letterB = await captureLetter(app, officer.workspace.id, "Letter B");

    // A real letter in a second, unrelated workspace.
    const officer2 = await createWorkspaceMember({ role: "owner" });
    await grantGeneralManagement(officer2.workspace.id, officer2.user.id);
    mockAuthenticatedSession(officer2.user);
    const { app: app2 } = createApp();
    const letterD = await captureLetter(
      app2,
      officer2.workspace.id,
      "Letter D (other workspace)",
    );

    // The API itself refuses to create a cross-workspace link (both ends are
    // loaded scoped to the caller's workspace), so insert the edge directly —
    // this is the row shape a pre-existing/legacy bad link would have.
    await db.insert(schema.letterLinkTable).values({
      fromLetterId: letterD.id,
      toLetterId: letterB.id,
      relation: "related",
    });

    mockAuthenticatedSession(officer.user);
    const { app: appAsOfficer } = createApp();
    const response = await getThread(
      appAsOfficer,
      officer.workspace.id,
      letterB.id,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.letters.map((l: { id: string }) => l.id)).toEqual([letterB.id]);
    expect(body.letters.some((l: { id: string }) => l.id === letterD.id)).toBe(
      false,
    );
    expect(body.truncated).toBe(false);
  });

  it("does not let a link pointing OUT to another workspace consume a slot of the walk's cap", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    await grantGeneralManagement(officer.workspace.id, officer.user.id);
    mockAuthenticatedSession(officer.user);
    const { app } = createApp();
    const seed = await captureLetter(app, officer.workspace.id, "Seed");

    // Fill the walk's 100-letter cap EXACTLY with real, local letters
    // directly linked to the seed (seed + 99 = 100), so no local edge on its
    // own can trip `truncated`. This is what makes the foreign edge below
    // the deciding factor.
    const localRows = await db
      .insert(schema.letterTable)
      .values(
        Array.from({ length: 99 }, (_, i) => ({
          workspaceId: officer.workspace.id,
          direction: "in",
          type: "external",
          medium: "email",
          subject: `Local ${i}`,
        })),
      )
      .returning({ id: schema.letterTable.id });

    // A real letter in a second, unrelated workspace.
    const officer2 = await createWorkspaceMember({ role: "owner" });
    const [foreignLetter] = await db
      .insert(schema.letterTable)
      .values({
        workspaceId: officer2.workspace.id,
        direction: "in",
        type: "external",
        medium: "email",
        subject: "Foreign",
      })
      .returning({ id: schema.letterTable.id });

    // The mirror of the inbound test above: this time the LOCAL seed is the
    // `from` side, linking OUT to the foreign letter, alongside the 99 local
    // links that exactly fill the cap. The API itself refuses to create a
    // cross-workspace link, so insert the edges directly.
    await db.insert(schema.letterLinkTable).values([
      ...localRows.map((r) => ({
        fromLetterId: seed.id,
        toLetterId: r.id,
        relation: "related",
      })),
      {
        fromLetterId: seed.id,
        toLetterId: foreignLetter.id,
        relation: "related",
      },
    ]);

    const response = await getThread(app, officer.workspace.id, seed.id);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(
      body.letters.some((l: { id: string }) => l.id === foreignLetter.id),
    ).toBe(false);
    // The pinning assertion: with the seed and its 99 real local links
    // exactly filling the 100-letter cap, the walk must stay untruncated.
    // If the foreign edge had entered walkThread's neighbour graph, it would
    // have contended for the same 100 slots and forced this to true —
    // meaning a caller could be told their thread was truncated by data they
    // can never see.
    expect(body.truncated).toBe(false);
  });

  it("returns only itself, not truncated, for a letter with no links", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    await grantGeneralManagement(officer.workspace.id, officer.user.id);
    mockAuthenticatedSession(officer.user);
    const { app } = createApp();
    const letterE = await captureLetter(app, officer.workspace.id, "Letter E");

    const response = await getThread(app, officer.workspace.id, letterE.id);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.letters).toHaveLength(1);
    expect(body.letters[0].id).toBe(letterE.id);
    expect(body.letters[0].isSeed).toBe(true);
    expect(body.truncated).toBe(false);
  });
});
