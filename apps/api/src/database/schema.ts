import { createId } from "@paralleldrive/cuid2";
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const userTable = pgTable("user", {
  id: text("id")
    .$defaultFn(() => createId())
    .primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified")
    .$defaultFn(() => false)
    .notNull(),
  image: text("image"),
  locale: text("locale"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  isAnonymous: boolean("is_anonymous").default(false),
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { mode: "date" }),
});

export const sessionTable = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    activeOrganizationId: text("active_organization_id"),
    activeTeamId: text("active_team_id"),
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const accountTable = pgTable(
  "account",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      mode: "date",
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      mode: "date",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verificationTable = pgTable(
  "verification",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const workspaceTable = pgTable("workspace", {
  id: text("id")
    .$defaultFn(() => createId())
    .primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  description: text("description"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull(),
});

export const workspaceUserTable = pgTable(
  "workspace_member",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
      }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
      }),
    role: text("role").default("member").notNull(),
    joinedAt: timestamp("joined_at", { mode: "date" }).notNull(),
  },
  (table) => [
    index("workspace_member_workspaceId_idx").on(table.workspaceId),
    index("workspace_member_userId_idx").on(table.userId),
  ],
);

// Per-user access grants for the gateable sidebar "pages" (the business-domain
// sub-categories). A row's presence = access granted; absence = denied
// (default-deny). Owner / global-admins bypass this table entirely. Home and
// Projects are always available and are NOT represented here.
export const workspacePageAccessTable = pgTable(
  "workspace_page_access",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
      }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
      }),
    pageSlug: text("page_slug").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("workspace_page_access_workspaceId_idx").on(table.workspaceId),
    index("workspace_page_access_userId_idx").on(table.userId),
    unique("workspace_page_access_unique").on(
      table.workspaceId,
      table.userId,
      table.pageSlug,
    ),
  ],
);

// ── Asset registry (user-facing "Assets Management") ─────────────────────────
// NOTE: distinct from `assetTable` ("asset"), which stores task file blobs.
// Money is stored as integer minor units (e.g. sen/cents); currency per asset.

export const registeredAssetTable = pgTable(
  "registered_asset",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, { onDelete: "cascade" }),
    serialNumber: text("serial_number").notNull(),
    assetTag: text("asset_tag"),
    name: text("name").notNull(),
    // it-equipment | media-equipment | vehicle | other
    category: text("category").notNull().default("other"),
    manufacturer: text("manufacturer"),
    model: text("model"),
    // active | in-maintenance | retired | disposed
    status: text("status").notNull().default("active"),
    location: text("location"), // legacy free-text; superseded by locationId
    locationId: text("location_id"),
    // Legacy free-text holder (kept for back-compat); superseded by
    // currentCustodianId + the asset_custody history table.
    assignedTo: text("assigned_to"),
    currentCustodianId: text("current_custodian_id").references(
      () => userTable.id,
      { onDelete: "set null" },
    ),
    registrationNumber: text("registration_number"),
    purchaseDate: timestamp("purchase_date", { mode: "date" }),
    purchaseCost: integer("purchase_cost"),
    currency: text("currency").notNull().default("MYR"),
    // Straight-line depreciation (fixed-asset accounting). usefulLifeMonths
    // null → not depreciated (NBV stays at cost). Defaults set by category.
    depreciationMethod: text("depreciation_method")
      .notNull()
      .default("straight-line"),
    usefulLifeMonths: integer("useful_life_months"),
    salvageValue: integer("salvage_value").default(0),
    inServiceDate: timestamp("in_service_date", { mode: "date" }),
    vendor: text("vendor"),
    notes: text("notes"),
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("registered_asset_workspaceId_idx").on(table.workspaceId),
    unique("registered_asset_serial_unique").on(
      table.workspaceId,
      table.serialNumber,
    ),
  ],
);

export const assetRenewalTable = pgTable(
  "asset_renewal",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => registeredAssetTable.id, { onDelete: "cascade" }),
    // road-tax | insurance | inspection | licence | warranty | other
    type: text("type").notNull().default("other"),
    label: text("label"),
    dueDate: timestamp("due_date", { mode: "date" }).notNull(),
    lastRenewedDate: timestamp("last_renewed_date", { mode: "date" }),
    cost: integer("cost"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("asset_renewal_assetId_idx").on(table.assetId),
    index("asset_renewal_dueDate_idx").on(table.dueDate),
  ],
);

export const assetMaintenanceTable = pgTable(
  "asset_maintenance",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => registeredAssetTable.id, { onDelete: "cascade" }),
    date: timestamp("date", { mode: "date" }).notNull(),
    title: text("title").notNull(),
    notes: text("notes"),
    cost: integer("cost"),
    vendor: text("vendor"),
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("asset_maintenance_assetId_idx").on(table.assetId)],
);

export const assetCostTable = pgTable(
  "asset_cost",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => registeredAssetTable.id, { onDelete: "cascade" }),
    date: timestamp("date", { mode: "date" }).notNull(),
    // purchase | maintenance | insurance | road-tax | fuel | repair | accessory | other
    category: text("category").notNull().default("other"),
    amount: integer("amount").notNull(),
    note: text("note"),
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("asset_cost_assetId_idx").on(table.assetId)],
);

export const assetTripTable = pgTable(
  "asset_trip",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => registeredAssetTable.id, { onDelete: "cascade" }),
    date: timestamp("date", { mode: "date" }).notNull(),
    origin: text("origin"),
    destination: text("destination"),
    distanceKm: integer("distance_km"),
    purpose: text("purpose"),
    driver: text("driver"), // legacy free-text; superseded by driverId
    driverId: text("driver_id").references(() => userTable.id, {
      onDelete: "set null",
    }),
    cost: integer("cost"),
    notes: text("notes"),
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("asset_trip_assetId_idx").on(table.assetId)],
);

export const assetFileTable = pgTable(
  "asset_file",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => registeredAssetTable.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull().unique(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    // image | document
    kind: text("kind").notNull().default("document"),
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("asset_file_assetId_idx").on(table.assetId)],
);

// Custody chain: who held an asset and when. The open row (releasedAt IS NULL)
// is the current custodian; also denormalized onto registered_asset for lists.
export const assetCustodyTable = pgTable(
  "asset_custody",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => registeredAssetTable.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => userTable.id, {
      onDelete: "set null",
    }),
    assignedBy: text("assigned_by").references(() => userTable.id, {
      onDelete: "set null",
    }),
    assignedAt: timestamp("assigned_at", { mode: "date" })
      .defaultNow()
      .notNull(),
    releasedAt: timestamp("released_at", { mode: "date" }),
    note: text("note"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("asset_custody_assetId_idx").on(table.assetId)],
);

// Audit trail: one row per asset change (who/what/when). Mirrors activityTable.
export const assetActivityTable = pgTable(
  "asset_activity",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => registeredAssetTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    userId: text("user_id").references(() => userTable.id, {
      onDelete: "set null",
    }),
    content: text("content"),
    eventData: jsonb("event_data"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("asset_activity_assetId_idx").on(table.assetId)],
);

// Dedup ledger for asset reminders: one row per (refType, refId, window) so a
// given reminder window fires at most once. refType is polymorphic (renewal
// now; pm-schedule / warranty later) — no FK so it stays generic.
export const assetReminderSentTable = pgTable(
  "asset_reminder_sent",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    refType: text("ref_type").notNull(),
    refId: text("ref_id").notNull(),
    reminderWindow: text("reminder_window").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    unique("asset_reminder_sent_unique").on(
      table.refType,
      table.refId,
      table.reminderWindow,
    ),
    index("asset_reminder_sent_ref_idx").on(table.refType, table.refId),
  ],
);

// Disposal / retirement record (one per asset). Setting it flips the asset to
// status='disposed'. Gain/loss = proceeds − net book value (computed).
export const assetDisposalTable = pgTable(
  "asset_disposal",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .unique()
      .references(() => registeredAssetTable.id, { onDelete: "cascade" }),
    date: timestamp("date", { mode: "date" }).notNull(),
    // sold | scrapped | donated | written-off | lost
    method: text("method").notNull().default("sold"),
    proceeds: integer("proceeds"),
    reason: text("reason"),
    approvedBy: text("approved_by").references(() => userTable.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("asset_disposal_assetId_idx").on(table.assetId)],
);

// Preventive-maintenance schedule: recurring plan per asset. nextDueDate is
// stored and advanced when a cycle completes (mark done / linked work order).
export const assetPmScheduleTable = pgTable(
  "asset_pm_schedule",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => registeredAssetTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    intervalType: text("interval_type").notNull().default("months"), // days | months | km | hours
    intervalValue: integer("interval_value").notNull(),
    lastDoneDate: timestamp("last_done_date", { mode: "date" }),
    // Time-based schedules use nextDueDate; meter-based use nextDueMeter.
    nextDueDate: timestamp("next_due_date", { mode: "date" }),
    lastDoneMeter: integer("last_done_meter"),
    nextDueMeter: integer("next_due_meter"),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("asset_pm_schedule_assetId_idx").on(table.assetId)],
);

// Work order: request → scheduled → in-progress → done lifecycle. Workspace-
// scoped (for the cross-asset kanban + assignee Home), tied to one asset.
export const workOrderTable = pgTable(
  "work_order",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => registeredAssetTable.id, { onDelete: "cascade" }),
    pmScheduleId: text("pm_schedule_id").references(
      () => assetPmScheduleTable.id,
      { onDelete: "set null" },
    ),
    title: text("title").notNull(),
    description: text("description"),
    // requested | scheduled | in-progress | done | cancelled
    status: text("status").notNull().default("requested"),
    priority: text("priority").notNull().default("medium"),
    assigneeId: text("assignee_id").references(() => userTable.id, {
      onDelete: "set null",
    }),
    dueDate: timestamp("due_date", { mode: "date" }),
    completedAt: timestamp("completed_at", { mode: "date" }),
    cost: integer("cost"),
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("work_order_workspaceId_idx").on(table.workspaceId),
    index("work_order_assigneeId_idx").on(table.assigneeId),
    index("work_order_assetId_idx").on(table.assetId),
  ],
);

// Cumulative meter readings (odometer km / run hours). Latest = current value.
export const assetMeterReadingTable = pgTable(
  "asset_meter_reading",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => registeredAssetTable.id, { onDelete: "cascade" }),
    date: timestamp("date", { mode: "date" }).notNull(),
    value: integer("value").notNull(),
    unit: text("unit").notNull().default("km"), // km | hours
    note: text("note"),
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("asset_meter_reading_assetId_idx").on(table.assetId)],
);

// Fuel log. volume stored in centilitres (1 L = 100); cost in minor units.
export const assetFuelLogTable = pgTable(
  "asset_fuel_log",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => registeredAssetTable.id, { onDelete: "cascade" }),
    date: timestamp("date", { mode: "date" }).notNull(),
    volume: integer("volume"),
    cost: integer("cost"),
    odometer: integer("odometer"),
    driverId: text("driver_id").references(() => userTable.id, {
      onDelete: "set null",
    }),
    note: text("note"),
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("asset_fuel_log_assetId_idx").on(table.assetId)],
);

// Driver profile: licence details for a workspace user who drives assets.
export const driverProfileTable = pgTable(
  "driver_profile",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    licenceNo: text("licence_no"),
    licenceClass: text("licence_class"),
    licenceExpiry: timestamp("licence_expiry", { mode: "date" }),
    phone: text("phone"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("driver_profile_workspaceId_idx").on(table.workspaceId),
    unique("driver_profile_workspace_user_unique").on(
      table.workspaceId,
      table.userId,
    ),
  ],
);

// Hierarchical location tree (site → building → floor → room). parentId is a
// self-reference (no FK — children are re-parented to null on delete in code).
export const assetLocationTable = pgTable(
  "asset_location",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    name: text("name").notNull(),
    type: text("type").notNull().default("room"), // site | building | floor | room
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("asset_location_workspaceId_idx").on(table.workspaceId)],
);

// Physical stock-take session: scan assets to reconcile against the registry.
export const assetAuditSessionTable = pgTable(
  "asset_audit_session",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    startedBy: text("started_by").references(() => userTable.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at", { mode: "date" }).defaultNow().notNull(),
    closedAt: timestamp("closed_at", { mode: "date" }),
  },
  (table) => [
    index("asset_audit_session_workspaceId_idx").on(table.workspaceId),
  ],
);

export const assetAuditScanTable = pgTable(
  "asset_audit_scan",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => assetAuditSessionTable.id, { onDelete: "cascade" }),
    assetId: text("asset_id").references(() => registeredAssetTable.id, {
      onDelete: "set null",
    }),
    scannedSerial: text("scanned_serial").notNull(),
    // found | unexpected
    status: text("status").notNull().default("found"),
    locationId: text("location_id"),
    scannedBy: text("scanned_by").references(() => userTable.id, {
      onDelete: "set null",
    }),
    scannedAt: timestamp("scanned_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("asset_audit_scan_sessionId_idx").on(table.sessionId)],
);

export const teamTable = pgTable(
  "team",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(
      () => /* @__PURE__ */ new Date(),
    ),
  },
  (table) => [index("team_workspaceId_idx").on(table.workspaceId)],
);

export const teamMemberTable = pgTable(
  "team_member",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teamTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("teamMember_teamId_idx").on(table.teamId),
    index("teamMember_userId_idx").on(table.userId),
  ],
);

export const invitationTable = pgTable(
  "invitation",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    teamId: text("team_id"),
    status: text("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("invitation_workspaceId_idx").on(table.workspaceId),
    index("invitation_email_idx").on(table.email),
    index("invitation_inviterId_idx").on(table.inviterId),
  ],
);

export const workspaceRoleTable = pgTable(
  "workspace_role",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    role: text("role").notNull(),
    permission: text("permission").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("workspace_role_workspaceId_idx").on(table.workspaceId),
    index("workspace_role_role_idx").on(table.role),
    unique("workspace_role_workspace_id_role_unique").on(
      table.workspaceId,
      table.role,
    ),
  ],
);

export const projectTable = pgTable(
  "project",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    slug: text("slug").notNull(),
    icon: text("icon").default("Layout"),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    isPublic: boolean("is_public").default(false),
    archivedAt: timestamp("archived_at", { mode: "date" }),
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    unique("project_workspace_id_id_unique").on(table.workspaceId, table.id),
  ],
);

/**
 * Per-project membership. Only members (plus workspace owners/admins, who are
 * "global admins") can access a project. `role` is "manager" | "member" —
 * managers (and the creator) can manage project membership.
 */
export const projectMemberTable = pgTable(
  "project_member",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("project_member_projectId_idx").on(table.projectId),
    index("project_member_userId_idx").on(table.userId),
    unique("project_member_project_user_unique").on(
      table.projectId,
      table.userId,
    ),
  ],
);

/** A pending request from a workspace member to join a project they can't access. */
export const projectAccessRequestTable = pgTable(
  "project_access_request",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("project_access_request_projectId_idx").on(table.projectId),
    unique("project_access_request_project_user_unique").on(
      table.projectId,
      table.userId,
    ),
  ],
);

export const columnTable = pgTable(
  "column",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    position: integer("position").notNull().default(0),
    icon: text("icon"),
    color: text("color"),
    isFinal: boolean("is_final").default(false).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("column_projectId_idx").on(table.projectId)],
);

export const workflowRuleTable = pgTable(
  "workflow_rule",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    integrationType: text("integration_type").notNull(),
    eventType: text("event_type").notNull(),
    columnId: text("column_id")
      .notNull()
      .references(() => columnTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("workflow_rule_projectId_idx").on(table.projectId),
    index("workflow_rule_columnId_idx").on(table.columnId),
  ],
);

export const taskTable = pgTable(
  "task",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    position: integer("position").default(0),
    number: integer("number").default(1),
    userId: text("assignee_id").references(() => userTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("to-do"),
    columnId: text("column_id").references(() => columnTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    priority: text("priority").default("low"),
    startDate: timestamp("start_date", { mode: "date" }),
    dueDate: timestamp("due_date", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("task_projectId_idx").on(table.projectId),
    index("task_dueDate_idx").on(table.dueDate),
    index("task_assigneeId_idx").on(table.userId),
    index("task_columnId_idx").on(table.columnId),
    unique("task_project_number_unique").on(table.projectId, table.number),
  ],
);

export const taskReminderSentTable = pgTable(
  "task_reminder_sent",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    reminderType: text("reminder_type").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("task_reminder_sent_taskId_idx").on(table.taskId),
    unique("task_reminder_sent_task_type_unique").on(
      table.taskId,
      table.reminderType,
    ),
  ],
);

export const timeEntryTable = pgTable(
  "time_entry",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: text("user_id").references(() => userTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    description: text("description"),
    startTime: timestamp("start_time", { mode: "date" }).notNull(),
    endTime: timestamp("end_time", { mode: "date" }),
    duration: integer("duration").default(0),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("time_entry_taskId_idx").on(table.taskId),
    index("time_entry_userId_idx").on(table.userId),
  ],
);

export const activityTable = pgTable(
  "activity",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    type: text("type").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    userId: text("user_id").references(() => userTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    content: text("content"),
    eventData: jsonb("event_data"),
    externalUserName: text("external_user_name"),
    externalUserAvatar: text("external_user_avatar"),
    externalSource: text("external_source"),
    externalUrl: text("external_url"),
  },
  (table) => [
    index("activity_task_id_idx").on(table.taskId),
    index("activity_userId_idx").on(table.userId),
    unique("activity_task_external_source_external_url_unique").on(
      table.taskId,
      table.externalSource,
      table.externalUrl,
    ),
  ],
);

export const assetTable = pgTable(
  "asset",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    taskId: text("task_id").references(() => taskTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    activityId: text("activity_id").references(() => activityTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    objectKey: text("object_key").notNull().unique(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    kind: text("kind").notNull().default("image"),
    surface: text("surface").notNull().default("description"),
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("asset_workspaceId_idx").on(table.workspaceId),
    index("asset_projectId_idx").on(table.projectId),
    index("asset_taskId_idx").on(table.taskId),
    index("asset_activityId_idx").on(table.activityId),
    index("asset_createdBy_idx").on(table.createdBy),
  ],
);

export const labelTable = pgTable(
  "label",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    name: text("name").notNull(),
    color: text("color").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    taskId: text("task_id").references(() => taskTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    workspaceId: text("workspace_id").references(() => workspaceTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
  },
  (table) => [
    index("label_task_id_idx").on(table.taskId),
    index("label_workspace_id_idx").on(table.workspaceId),
    unique("label_task_name_unique").on(table.taskId, table.name),
    uniqueIndex("label_workspace_name_unique")
      .on(table.workspaceId, table.name)
      .where(sql`${table.taskId} is null`),
  ],
);

export const notificationTable = pgTable(
  "notification",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    title: text("title"),
    content: text("content"),
    type: text("type").notNull().default("info"),
    eventData: jsonb("event_data"),
    isRead: boolean("is_read").default(false),
    resourceId: text("resource_id"),
    resourceType: text("resource_type"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("notification_userId_idx").on(table.userId)],
);

export const userNotificationPreferenceTable = pgTable(
  "user_notification_preference",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    emailEnabled: boolean("email_enabled").default(false).notNull(),
    ntfyEnabled: boolean("ntfy_enabled").default(false).notNull(),
    ntfyServerUrl: text("ntfy_server_url"),
    ntfyTopic: text("ntfy_topic"),
    ntfyToken: text("ntfy_token"),
    gotifyEnabled: boolean("gotify_enabled").default(false).notNull(),
    gotifyServerUrl: text("gotify_server_url"),
    gotifyToken: text("gotify_token"),
    webhookEnabled: boolean("webhook_enabled").default(false).notNull(),
    webhookUrl: text("webhook_url"),
    webhookSecret: text("webhook_secret"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
);

export const userNotificationWorkspaceRuleTable = pgTable(
  "user_notification_workspace_rule",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    isActive: boolean("is_active").default(true).notNull(),
    emailEnabled: boolean("email_enabled").default(false).notNull(),
    ntfyEnabled: boolean("ntfy_enabled").default(false).notNull(),
    gotifyEnabled: boolean("gotify_enabled").default(false).notNull(),
    webhookEnabled: boolean("webhook_enabled").default(false).notNull(),
    projectMode: text("project_mode").default("all").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("user_notification_workspace_rule_userId_idx").on(table.userId),
    index("user_notification_workspace_rule_workspaceId_idx").on(
      table.workspaceId,
    ),
    unique("user_notification_workspace_rule_user_workspace_unique").on(
      table.userId,
      table.workspaceId,
    ),
    unique("user_notification_workspace_rule_workspace_id_id_unique").on(
      table.workspaceId,
      table.id,
    ),
  ],
);

export const userNotificationWorkspaceProjectTable = pgTable(
  "user_notification_workspace_project",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    workspaceRuleId: text("workspace_rule_id").notNull(),
    projectId: text("project_id").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.workspaceRuleId],
      foreignColumns: [
        userNotificationWorkspaceRuleTable.workspaceId,
        userNotificationWorkspaceRuleTable.id,
      ],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projectTable.workspaceId, projectTable.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    index("user_notification_workspace_project_ruleId_idx").on(
      table.workspaceRuleId,
    ),
    index("user_notification_workspace_project_projectId_idx").on(
      table.projectId,
    ),
    index("user_notification_workspace_project_workspaceId_projectId_idx").on(
      table.workspaceId,
      table.projectId,
    ),
    index("unwp_workspaceId_workspaceRuleId_idx").on(
      table.workspaceId,
      table.workspaceRuleId,
    ),
    unique("user_notification_workspace_project_rule_project_unique").on(
      table.workspaceRuleId,
      table.projectId,
    ),
  ],
);

export const githubIntegrationTable = pgTable("github_integration", {
  id: text("id")
    .$defaultFn(() => createId())
    .primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projectTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    })
    .unique(),
  repositoryOwner: text("repository_owner").notNull(),
  repositoryName: text("repository_name").notNull(),
  installationId: integer("installation_id"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const integrationTable = pgTable(
  "integration",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    type: text("type").notNull(),
    config: text("config").notNull(),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("integration_projectId_idx").on(table.projectId),
    index("integration_type_idx").on(table.type),
    unique("integration_project_type_unique").on(table.projectId, table.type),
  ],
);

export const externalLinkTable = pgTable(
  "external_link",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    integrationId: text("integration_id")
      .notNull()
      .references(() => integrationTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    resourceType: text("resource_type").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    title: text("title"),
    metadata: text("metadata"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("external_link_taskId_idx").on(table.taskId),
    index("external_link_integrationId_idx").on(table.integrationId),
    index("external_link_externalId_idx").on(table.externalId),
    index("external_link_resourceType_idx").on(table.resourceType),
  ],
);

export const commentTable = pgTable(
  "comment",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("comment_task_idx").on(table.taskId),
    index("comment_user_idx").on(table.userId),
  ],
);

export const taskRelationTable = pgTable(
  "task_relation",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    sourceTaskId: text("source_task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    targetTaskId: text("target_task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    relationType: text("relation_type").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("task_relation_source_idx").on(table.sourceTaskId),
    index("task_relation_target_idx").on(table.targetTaskId),
  ],
);

export const apikeyTable = pgTable(
  "apikey",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    configId: text("config_id").default("default").notNull(),
    name: text("name"),
    start: text("start"),
    referenceId: text("reference_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    prefix: text("prefix"),
    key: text("key").notNull(),
    userId: text("user_id").references(() => userTable.id, {
      onDelete: "cascade",
    }),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: timestamp("last_refill_at", { mode: "date" }),
    enabled: boolean("enabled").default(true),
    rateLimitEnabled: boolean("rate_limit_enabled").default(true),
    rateLimitTimeWindow: integer("rate_limit_time_window").default(86400000),
    rateLimitMax: integer("rate_limit_max").default(10),
    requestCount: integer("request_count").default(0),
    remaining: integer("remaining"),
    lastRequest: timestamp("last_request", { mode: "date" }),
    expiresAt: timestamp("expires_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
    permissions: text("permissions"),
    metadata: text("metadata"),
  },
  (table) => [
    index("apikey_configId_idx").on(table.configId),
    index("apikey_key_idx").on(table.key),
    index("apikey_referenceId_idx").on(table.referenceId),
    index("apikey_userId_idx").on(table.userId),
  ],
);

export const deviceCodeTable = pgTable(
  "device_code",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    deviceCode: text("device_code").notNull(),
    userCode: text("user_code").notNull(),
    userId: text("user_id").references(() => userTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    status: text("status").notNull(),
    lastPolledAt: timestamp("last_polled_at", { mode: "date" }),
    pollingInterval: integer("polling_interval"),
    clientId: text("client_id"),
    scope: text("scope"),
  },
  (table) => [
    uniqueIndex("device_code_device_code_uidx").on(table.deviceCode),
    uniqueIndex("device_code_user_code_uidx").on(table.userCode),
    index("device_code_user_id_idx").on(table.userId),
  ],
);

// Auth-schema compatible aliases in schema.ts
export const user = userTable;
export const session = sessionTable;
export const account = accountTable;
export const verification = verificationTable;
export const workspace = workspaceTable;
export const team = teamTable;
export const teamMember = teamMemberTable;
export const workspace_member = workspaceUserTable;
export const invitation = invitationTable;
export const organizationRole = workspaceRoleTable;
export const apikey = apikeyTable;
export const deviceCode = deviceCodeTable;

// Auth-schema compatible relation exports in schema.ts
export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  teamMembers: many(teamMember),
  workspace_members: many(workspace_member),
  invitations: many(invitation),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const workspaceRelations = relations(workspace, ({ many }) => ({
  teams: many(team),
  workspace_members: many(workspace_member),
  invitations: many(invitation),
}));

export const teamRelations = relations(team, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [team.workspaceId],
    references: [workspace.id],
  }),
  teamMembers: many(teamMember),
}));

export const teamMemberRelations = relations(teamMember, ({ one }) => ({
  team: one(team, {
    fields: [teamMember.teamId],
    references: [team.id],
  }),
  user: one(user, {
    fields: [teamMember.userId],
    references: [user.id],
  }),
}));

export const workspace_memberRelations = relations(
  workspace_member,
  ({ one }) => ({
    workspace: one(workspace, {
      fields: [workspace_member.workspaceId],
      references: [workspace.id],
    }),
    user: one(user, {
      fields: [workspace_member.userId],
      references: [user.id],
    }),
  }),
);

export const invitationRelations = relations(invitation, ({ one }) => ({
  workspace: one(workspace, {
    fields: [invitation.workspaceId],
    references: [workspace.id],
  }),
  user: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
}));

export const organizationRoleRelations = relations(
  organizationRole,
  ({ one }) => ({
    workspace: one(workspace, {
      fields: [organizationRole.workspaceId],
      references: [workspace.id],
    }),
  }),
);

/**
 * Per-user Google Calendar connection (one-way Kaneo → Calendar sync).
 * Stores the OAuth refresh token so we can mint access tokens server-side.
 */
export const googleCalendarConnectionTable = pgTable(
  "google_calendar_connection",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => userTable.id, { onDelete: "cascade" }),
    googleEmail: text("google_email"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date" }),
    calendarId: text("calendar_id").notNull().default("primary"),
    scope: text("scope"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
);

/**
 * Maps a task to the Google Calendar event mirroring it, and which user's
 * calendar holds it (the assignee at sync time).
 */
export const taskCalendarEventTable = pgTable(
  "task_calendar_event",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    taskId: text("task_id")
      .notNull()
      .unique()
      .references(() => taskTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    calendarId: text("calendar_id").notNull().default("primary"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("task_calendar_event_userId_idx").on(table.userId)],
);

/** A Google Drive file attached to a task via the Google Picker (link only). */
export const taskDriveAttachmentTable = pgTable(
  "task_drive_attachment",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    fileId: text("file_id").notNull(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    iconUrl: text("icon_url"),
    mimeType: text("mime_type"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("task_drive_attachment_taskId_idx").on(table.taskId),
    unique("task_drive_attachment_task_file_unique").on(
      table.taskId,
      table.fileId,
    ),
  ],
);

// Minutes of Meeting — one structured document per task. The whole document
// (date, time, attendees, absentees, agenda/discussion/action rows with tagged
// users) is stored as a single JSON blob for flexibility.
export const taskMomTable = pgTable(
  "task_mom",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    taskId: text("task_id")
      .notNull()
      .unique()
      .references(() => taskTable.id, { onDelete: "cascade" }),
    data: jsonb("data").notNull(),
    updatedBy: text("updated_by").references(() => userTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("task_mom_taskId_idx").on(table.taskId)],
);
