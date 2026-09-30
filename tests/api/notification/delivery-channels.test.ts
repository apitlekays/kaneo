import { describe, expect, it, vi } from "vitest";

// delivery.ts imports the database; the resolver under test never touches it.
vi.mock("../../../apps/api/src/database", () => ({ default: {} }));

import {
  EMAIL_NOTIFICATION_TYPES,
  resolveDeliveryChannels,
} from "../../../apps/api/src/notification-preferences/delivery";

const base = {
  type: "task_offered",
  hasEmailAddress: true,
  preference: null,
  rule: null,
  projectId: "p1",
};

const rule = {
  isActive: true,
  emailEnabled: true,
  ntfyEnabled: false,
  gotifyEnabled: false,
  webhookEnabled: false,
  projectMode: "all",
  selectedProjectIds: [] as string[],
};

describe("resolveDeliveryChannels", () => {
  it("emails an offer to someone who has never saved any settings", () => {
    expect(resolveDeliveryChannels(base).email).toBe(true);
  });

  it("emails offers, assignments and reminders — and nothing else", () => {
    for (const type of [
      "task_offered",
      "letter_assigned",
      "meeting_action_assigned",
      "letter_action_assigned",
      "work_order_assigned",
      "task_tagged",
      "due_date_reminder",
      "task_overdue",
      "asset_maintenance_due",
      "asset_renewal_reminder",
    ]) {
      expect(EMAIL_NOTIFICATION_TYPES.has(type)).toBe(true);
      expect(resolveDeliveryChannels({ ...base, type }).email).toBe(true);
    }
    for (const type of [
      "task_status_changed",
      "task_commented",
      "task_assignee_changed",
      "task_accepted",
      "task_rejected",
      "time_entry_created",
      "workspace_created",
    ]) {
      expect(resolveDeliveryChannels({ ...base, type }).email).toBe(false);
    }
  });

  it("never emails a user with no address", () => {
    expect(
      resolveDeliveryChannels({ ...base, hasEmailAddress: false }).email,
    ).toBe(false);
  });

  it("respects email switched off for the account", () => {
    const preference = {
      emailEnabled: false,
      ntfyEnabled: false,
      gotifyEnabled: false,
      webhookEnabled: false,
    };
    expect(resolveDeliveryChannels({ ...base, preference }).email).toBe(false);
  });

  it("respects a paused workspace and email switched off for a workspace", () => {
    expect(
      resolveDeliveryChannels({ ...base, rule: { ...rule, isActive: false } })
        .email,
    ).toBe(false);
    expect(
      resolveDeliveryChannels({
        ...base,
        rule: { ...rule, emailEnabled: false },
      }).email,
    ).toBe(false);
  });

  it("narrows project notifications to the selected projects", () => {
    const selected = {
      ...rule,
      projectMode: "selected",
      selectedProjectIds: ["p2"],
    };
    expect(resolveDeliveryChannels({ ...base, rule: selected }).email).toBe(
      false,
    );
    expect(
      resolveDeliveryChannels({ ...base, projectId: "p2", rule: selected })
        .email,
    ).toBe(true);
  });

  it("does not drop a letter, meeting or asset because of project scope — they have no project", () => {
    const selected = {
      ...rule,
      projectMode: "selected",
      selectedProjectIds: ["p2"],
    };
    expect(
      resolveDeliveryChannels({
        ...base,
        type: "letter_assigned",
        projectId: null,
        rule: selected,
      }).email,
    ).toBe(true);
  });

  it("keeps ntfy, Gotify and webhooks opt-in: account switch and a workspace rule", () => {
    const preference = {
      emailEnabled: true,
      ntfyEnabled: true,
      gotifyEnabled: false,
      webhookEnabled: false,
    };
    expect(resolveDeliveryChannels({ ...base, preference }).ntfy).toBe(false);
    expect(
      resolveDeliveryChannels({
        ...base,
        preference,
        rule: { ...rule, ntfyEnabled: true },
      }).ntfy,
    ).toBe(true);
    // Not limited to the email types.
    expect(
      resolveDeliveryChannels({
        ...base,
        type: "task_commented",
        preference,
        rule: { ...rule, ntfyEnabled: true },
      }).ntfy,
    ).toBe(true);
  });
});
