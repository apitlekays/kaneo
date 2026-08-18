import { describe, expect, it } from "vitest";
import { schema } from "../../../apps/api/src/database";
import * as schemaModule from "../../../apps/api/src/database/schema";

describe("schema barrel", () => {
  /**
   * `schema` is a hand-maintained object literal, so a table added to
   * schema.ts but forgotten here reads back as `undefined` at runtime rather
   * than failing to compile. That is how project_member slipped through.
   */
  it("exposes every table defined in schema.ts", () => {
    const defined = Object.keys(schemaModule).filter((key) =>
      key.endsWith("Table"),
    );
    const exposed = new Set(Object.keys(schema));

    expect(defined.filter((table) => !exposed.has(table))).toEqual([]);
  });
});
