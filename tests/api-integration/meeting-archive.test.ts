import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import {
  resetDocumentTextExtractor,
  setDocumentTextExtractor,
} from "../../apps/api/src/meeting/indexing";
import {
  deleteS3Object,
  getPrivateObject,
} from "../../apps/api/src/storage/s3";
import { settleBackgroundWork } from "../../apps/api/src/utils/background-work";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceMember,
  grantGeneralManagement,
  type SeededMemberContext,
} from "./helpers/fixtures";

process.env.S3_ENDPOINT ||= "http://localhost:9000";
process.env.S3_BUCKET ||= "kaneo-test-bucket";
process.env.S3_ACCESS_KEY_ID ||= "test-access-key";
process.env.S3_SECRET_ACCESS_KEY ||= "test-secret-key";

vi.mock("../../apps/api/src/storage/s3", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../apps/api/src/storage/s3")>();
  return {
    ...actual,
    getPrivateObject: vi.fn(actual.getPrivateObject),
    deleteS3Object: vi.fn(async () => {}),
  };
});

type App = ReturnType<typeof createApp>["app"];
type User = SeededMemberContext["user"];

type ArchiveResponse = {
  items: Array<{
    id: string;
    title: string;
    status: string;
    referenceNo: string | null;
    documentCount: number;
    matchedDocuments: Array<{
      filename: string;
      snippet: string;
      snippets: string[];
    }>;
  }>;
  nextCursor: string | null;
  canManage: boolean;
};

const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Appears in no title or detail, only in document text. */
const UNIQUE_WORD = "QUINTESSA";

function as(user: User): App {
  mockAuthenticatedSession(user);
  return createApp().app;
}

const json = (method: string, body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function addMember(workspaceId: string, gm = true) {
  const seeded = await createWorkspaceMember({ role: "member" });
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: seeded.user.id,
    role: "member",
    joinedAt: new Date(),
  });
  if (gm) await grantGeneralManagement(workspaceId, seeded.user.id);
  return seeded.user;
}

function createPast(
  app: App,
  workspaceId: string,
  body: Record<string, unknown> = {},
) {
  return app.request(
    "/api/meeting/archive",
    json("POST", {
      workspaceId,
      title: "Mesyuarat Agung Tahunan 2015",
      scheduledAt: "2015-06-20",
      referenceNo: "MAT/2015/01",
      chairperson: "Dato' Chair",
      ...body,
    }),
  );
}

function finalize(
  app: App,
  workspaceId: string,
  meetingId: string,
  file: { filename: string; mimeType: string },
) {
  return app.request(
    `/api/meeting/${meetingId}/attachments/finalize`,
    json("POST", {
      workspaceId,
      objectKey: `workspace/${workspaceId}/meeting/${meetingId}/${file.filename}`,
      filename: file.filename,
      mimeType: file.mimeType,
      size: 1024,
      kind: "minutes",
    }),
  );
}

const listArchive = (app: App, workspaceId: string, query = "") =>
  app.request(`/api/meeting/archive?workspaceId=${workspaceId}${query}`);

describe("API integration: Past Minutes", () => {
  let owner: User;
  let workspaceId: string;
  let archivist: User;
  let officer: User;

  beforeEach(async () => {
    await resetTestDatabase();
    vi.mocked(getPrivateObject).mockImplementation(async (key: string) => ({
      body: Readable.from([Buffer.from(key)]),
      contentType: "application/octet-stream",
    }));
    vi.mocked(deleteS3Object).mockClear();
    setDocumentTextExtractor(async () => ({ text: "", source: "layer" }));

    const seeded = await createWorkspaceMember({ role: "owner" });
    owner = seeded.user;
    workspaceId = seeded.workspace.id;
    archivist = await addMember(workspaceId);
    officer = await addMember(workspaceId);
    const added = await as(owner).request(
      "/api/meeting/archive/archivists",
      json("POST", { workspaceId, userId: archivist.id }),
    );
    expect(added.status).toBe(201);
  });

  afterEach(async () => {
    await settleBackgroundWork();
    resetDocumentTextExtractor();
  });

  describe("who may manage the archive", () => {
    it("only a global admin chooses archivists", async () => {
      const res = await as(archivist).request(
        "/api/meeting/archive/archivists",
        json("POST", { workspaceId, userId: officer.id }),
      );
      expect(res.status).toBe(403);
    });

    it("lets an archivist record a past minute and refuses other page holders", async () => {
      const created = await createPast(as(archivist), workspaceId);
      expect(created.status).toBe(201);
      const row = (await created.json()) as { status: string };
      expect(row.status).toBe("archived");

      expect((await createPast(as(officer), workspaceId)).status).toBe(403);
    });

    it("tells the list whether the caller can manage it", async () => {
      const mine = (await (
        await listArchive(as(archivist), workspaceId)
      ).json()) as ArchiveResponse;
      expect(mine.canManage).toBe(true);
      const theirs = (await (
        await listArchive(as(officer), workspaceId)
      ).json()) as ArchiveResponse;
      expect(theirs.canManage).toBe(false);
    });

    it("lets only archivists upload to a past minute", async () => {
      const { id } = (await (
        await createPast(as(archivist), workspaceId)
      ).json()) as { id: string };
      const file = { filename: "minit.docx", mimeType: DOCX };
      expect((await finalize(as(officer), workspaceId, id, file)).status).toBe(
        403,
      );
      expect(
        (await finalize(as(archivist), workspaceId, id, file)).status,
      ).toBe(201);
    });
  });

  describe("file types", () => {
    it("accepts Word and PowerPoint, and refuses a type the extension contradicts", async () => {
      const { id } = (await (
        await createPast(as(archivist), workspaceId)
      ).json()) as { id: string };
      const app = as(archivist);
      for (const file of [
        { filename: "a.doc", mimeType: "application/msword" },
        { filename: "b.ppt", mimeType: "application/vnd.ms-powerpoint" },
        {
          filename: "c.pptx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        },
      ])
        expect((await finalize(app, workspaceId, id, file)).status).toBe(201);

      expect(
        (
          await finalize(app, workspaceId, id, {
            filename: "renamed.pdf",
            mimeType: DOCX,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await finalize(app, workspaceId, id, {
            filename: "sheet.xlsx",
            mimeType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          })
        ).status,
      ).toBe(400);
    });

    it("hands the extractor the stored type, and finds the text with each occurrence in context", async () => {
      const seen: string[] = [];
      setDocumentTextExtractor(async (_bytes, mimeType) => {
        seen.push(mimeType);
        return {
          text: `Perkara 1: ${UNIQUE_WORD} dibincang. ${"isi ".repeat(80)} Perkara 9: ${UNIQUE_WORD} diluluskan.`,
          source: "office",
        };
      });
      const { id } = (await (
        await createPast(as(archivist), workspaceId)
      ).json()) as { id: string };
      expect(
        (
          await finalize(as(archivist), workspaceId, id, {
            filename: "minit.docx",
            mimeType: DOCX,
          })
        ).status,
      ).toBe(201);
      await settleBackgroundWork();
      expect(seen).toEqual([DOCX]);

      const body = (await (
        await listArchive(as(officer), workspaceId, `&q=${UNIQUE_WORD}`)
      ).json()) as ArchiveResponse;
      expect(body.items.map((m) => m.id)).toEqual([id]);
      const [doc] = body.items[0]?.matchedDocuments ?? [];
      expect(doc?.filename).toBe("minit.docx");
      expect(doc?.snippets).toHaveLength(2);
      expect(doc?.snippets[0]).toContain("dibincang");
      expect(doc?.snippets[1]).toContain("diluluskan");
      expect(body.items[0]?.documentCount).toBe(1);
    });
  });

  describe("the two lists stay apart", () => {
    it("shows past minutes only under Past Minutes, and live meetings only in the main list", async () => {
      const { id: pastId } = (await (
        await createPast(as(archivist), workspaceId)
      ).json()) as { id: string };
      const live = await as(owner).request(
        "/api/meeting",
        json("POST", { workspaceId, title: "Live committee meeting" }),
      );
      const { id: liveId } = (await live.json()) as { id: string };

      const archive = (await (
        await listArchive(as(officer), workspaceId)
      ).json()) as ArchiveResponse;
      expect(archive.items.map((m) => m.id)).toEqual([pastId]);

      const main = (await (
        await as(officer).request(`/api/meeting?workspaceId=${workspaceId}`)
      ).json()) as ArchiveResponse;
      expect(main.items.map((m) => m.id)).toEqual([liveId]);
    });

    it("searches the recorded details", async () => {
      await createPast(as(archivist), workspaceId);
      const byRef = (await (
        await listArchive(as(officer), workspaceId, "&q=MAT%2F2015")
      ).json()) as ArchiveResponse;
      expect(byRef.items).toHaveLength(1);
      const byChair = (await (
        await listArchive(as(officer), workspaceId, "&q=chair")
      ).json()) as ArchiveResponse;
      expect(byChair.items).toHaveLength(1);
    });

    it("filters by date range and committee", async () => {
      const [body] = await db
        .insert(schema.meetingBodyTable)
        .values({ workspaceId, name: "Finance Committee" })
        .returning();
      await createPast(as(archivist), workspaceId, {
        title: "2012 meeting",
        scheduledAt: "2012-03-01",
      });
      await createPast(as(archivist), workspaceId, {
        title: "2018 finance",
        scheduledAt: "2018-12-31",
        bodyId: body?.id,
      });

      const in2018 = (await (
        await listArchive(
          as(officer),
          workspaceId,
          "&from=2018-01-01&to=2018-12-31",
        )
      ).json()) as ArchiveResponse;
      expect(in2018.items.map((m) => m.title)).toEqual(["2018 finance"]);

      const finance = (await (
        await listArchive(as(officer), workspaceId, `&bodyId=${body?.id}`)
      ).json()) as ArchiveResponse;
      expect(finance.items.map((m) => m.title)).toEqual(["2018 finance"]);

      expect(
        (await listArchive(as(officer), workspaceId, "&from=2018-02-30"))
          .status,
      ).toBe(400);
    });
  });

  describe("confidential past minutes", () => {
    it("are hidden from page holders, including by a word inside the document, but readable by archivists and admins", async () => {
      setDocumentTextExtractor(async () => ({
        text: `Rahsia: ${UNIQUE_WORD}`,
        source: "office",
      }));
      const { id } = (await (
        await createPast(as(archivist), workspaceId, { confidential: true })
      ).json()) as { id: string };
      await finalize(as(archivist), workspaceId, id, {
        filename: "rahsia.docx",
        mimeType: DOCX,
      });
      await settleBackgroundWork();

      const officerSearch = (await (
        await listArchive(as(officer), workspaceId, `&q=${UNIQUE_WORD}`)
      ).json()) as ArchiveResponse;
      expect(officerSearch.items).toHaveLength(0);
      expect(
        (
          await as(officer).request(
            `/api/meeting/${id}?workspaceId=${workspaceId}`,
          )
        ).status,
      ).toBe(403);

      for (const user of [archivist, owner]) {
        const found = (await (
          await listArchive(as(user), workspaceId, `&q=${UNIQUE_WORD}`)
        ).json()) as ArchiveResponse;
        expect(found.items.map((m) => m.id)).toEqual([id]);
      }
    });
  });

  describe("past minutes skip the live meeting flow", () => {
    it("refuses adoption and minute items", async () => {
      const { id } = (await (
        await createPast(as(archivist), workspaceId)
      ).json()) as { id: string };
      const live = (await (
        await as(owner).request(
          "/api/meeting",
          json("POST", { workspaceId, title: "Later meeting" }),
        )
      ).json()) as { id: string };

      expect(
        (
          await as(owner).request(
            `/api/meeting/${id}/adopt`,
            json("POST", { workspaceId, adoptedByMeetingId: live.id }),
          )
        ).status,
      ).toBe(409);
      expect(
        (
          await as(owner).request(
            `/api/meeting/${id}/minute-items`,
            json("POST", { workspaceId, topic: "Anything" }),
          )
        ).status,
      ).toBe(409);
    });
  });

  describe("editing and removing", () => {
    it("lets an archivist edit details, remove a document and remove the record", async () => {
      const app = as(archivist);
      const { id } = (await (await createPast(app, workspaceId)).json()) as {
        id: string;
      };
      const edited = await app.request(
        `/api/meeting/archive/${id}`,
        json("PUT", { workspaceId, referenceNo: "MAT/2015/02", summary: "" }),
      );
      expect(edited.status).toBe(200);
      const row = (await edited.json()) as {
        referenceNo: string;
        summary: string | null;
      };
      expect(row.referenceNo).toBe("MAT/2015/02");
      expect(row.summary).toBeNull();

      const doc = (await (
        await finalize(app, workspaceId, id, {
          filename: "minit.docx",
          mimeType: DOCX,
        })
      ).json()) as { id: string };
      await settleBackgroundWork();

      expect(
        (
          await as(officer).request(
            `/api/meeting/archive/${id}/documents/${doc.id}?workspaceId=${workspaceId}`,
            { method: "DELETE" },
          )
        ).status,
      ).toBe(403);
      // The session mock is global: signing in as the officer above means
      // the archivist must sign in again.
      expect(
        (
          await as(archivist).request(
            `/api/meeting/archive/${id}/documents/${doc.id}?workspaceId=${workspaceId}`,
            { method: "DELETE" },
          )
        ).status,
      ).toBe(200);
      expect(deleteS3Object).toHaveBeenCalledWith(
        `workspace/${workspaceId}/meeting/${id}/minit.docx`,
      );

      expect(
        (
          await as(archivist).request(
            `/api/meeting/archive/${id}?workspaceId=${workspaceId}`,
            { method: "DELETE" },
          )
        ).status,
      ).toBe(200);
      const left = await db
        .select({ id: schema.meetingTable.id })
        .from(schema.meetingTable)
        .where(eq(schema.meetingTable.id, id));
      expect(left).toHaveLength(0);
    });

    it("never edits a live meeting through the archive routes", async () => {
      const live = (await (
        await as(owner).request(
          "/api/meeting",
          json("POST", { workspaceId, title: "Live" }),
        )
      ).json()) as { id: string };
      expect(
        (
          await as(owner).request(
            `/api/meeting/archive/${live.id}?workspaceId=${workspaceId}`,
            { method: "DELETE" },
          )
        ).status,
      ).toBe(404);
    });
  });
});
