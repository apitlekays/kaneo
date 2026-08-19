import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  condition: undefined as SQL | undefined,
}));

// Stand-in for the drizzle delete chain, recording the condition it is handed.
vi.mock("../../../apps/api/src/database", () => ({
  default: {
    delete: () => ({
      where: async (condition: SQL) => {
        captured.condition = condition;
      },
    }),
  },
}));

import clearNotifications from "../../../apps/api/src/notification/controllers/clear-notifications";
import { FEED_TYPES } from "../../../apps/api/src/notification/feed-types";

function renderCondition() {
  if (!captured.condition) throw new Error("no delete condition captured");
  return new PgDialect().sqlToQuery(captured.condition);
}

describe("clearNotifications", () => {
  it("clears the user's own notifications", async () => {
    await clearNotifications("user-1");

    const { sql, params } = renderCondition();
    expect(sql).toContain('"user_id"');
    expect(params).toContain("user-1");
  });

  it("leaves the Home activity feed rows alone", async () => {
    // "Clear all" lives in the notification bell. The Home feed reads the
    // same table, so an unscoped delete wipes a user's activity history for
    // good on one confirmed click.
    await clearNotifications("user-1");

    const { sql, params } = renderCondition();
    expect(sql).toContain("not");
    for (const type of FEED_TYPES) {
      expect(params).toContain(type);
    }
  });
});
