import { Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ConfigItem } from "@/fetchers/correspondence";
import { useConfigList } from "@/hooks/queries/correspondence/use-config";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { ApprovalChainsEditor } from "./approval-chains-editor";
import {
  type ConfigColumn,
  type ConfigField,
  ConfigTable,
} from "./config-table";

type Option = { value: string; label: string };

type Spec = {
  title: string;
  description?: string;
  fields: ConfigField[];
  columns: ConfigColumn[];
  toForm?: (item: ConfigItem) => Record<string, string | number | boolean>;
  toBody?: (
    form: Record<string, string | number | boolean>,
  ) => Record<string, unknown>;
};

const LETTER_TYPES: Option[] = [
  { value: "external", label: "External" },
  { value: "memo", label: "Memo" },
  { value: "circular", label: "Circular" },
];

function buildSpecs(userOptions: Option[]): Record<string, Spec> {
  return {
    categories: {
      title: "Category",
      description: "The kinds of correspondence (complaint, invitation, …).",
      fields: [
        { key: "key", label: "Key", type: "text", required: true },
        { key: "label", label: "Label", type: "text", required: true },
      ],
      columns: [
        { key: "key", label: "Key" },
        { key: "label", label: "Label" },
      ],
    },
    "security-labels": {
      title: "Security label",
      description: "Classification levels; higher rank = more sensitive.",
      fields: [
        { key: "key", label: "Key", type: "text", required: true },
        { key: "label", label: "Label", type: "text", required: true },
        { key: "rank", label: "Rank", type: "number", defaultValue: 0 },
      ],
      columns: [
        { key: "label", label: "Label" },
        { key: "key", label: "Key" },
        { key: "rank", label: "Rank" },
      ],
    },
    "file-plan": {
      title: "File-plan node",
      description: "Subject classification (the fail structure).",
      fields: [
        { key: "code", label: "Code", type: "text" },
        { key: "name", label: "Name", type: "text", required: true },
        {
          key: "parentId",
          label: "Parent node id",
          type: "text",
          help: "Optional — leave blank for a top-level node.",
        },
      ],
      columns: [
        { key: "code", label: "Code" },
        { key: "name", label: "Name" },
      ],
    },
    "number-schemes": {
      title: "Numbering scheme",
      description:
        "Gap-free reference numbering per direction & type. Tokens: {direction} {type} {year} {serial}.",
      fields: [
        { key: "key", label: "Key", type: "text", required: true },
        { key: "label", label: "Label", type: "text", required: true },
        {
          key: "direction",
          label: "Direction",
          type: "select",
          required: true,
          options: [
            { value: "in", label: "Incoming (Surat Masuk)" },
            { value: "out", label: "Outgoing (Surat Keluar)" },
          ],
        },
        {
          key: "letterType",
          label: "Letter type",
          type: "select",
          required: true,
          options: LETTER_TYPES,
        },
        {
          key: "resetPolicy",
          label: "Reset",
          type: "select",
          defaultValue: "yearly",
          options: [
            { value: "yearly", label: "Yearly" },
            { value: "never", label: "Never" },
          ],
        },
        {
          key: "pattern",
          label: "Format pattern",
          type: "text",
          wide: true,
          placeholder: "MAPIM/{direction}/{year}/{serial}",
          help: "Tokens: {direction} {type} {year} {serial}",
        },
        {
          key: "serialPad",
          label: "Serial padding",
          type: "number",
          defaultValue: 5,
        },
      ],
      columns: [
        { key: "label", label: "Label" },
        { key: "direction", label: "Direction" },
        { key: "letterType", label: "Type" },
        {
          key: "pattern",
          label: "Pattern",
          render: (i) =>
            ((i.format as { pattern?: string } | undefined)?.pattern ??
              "—") as string,
        },
      ],
      toForm: (item) => {
        const format = (item.format ?? {}) as {
          pattern?: string;
          serialPad?: number;
        };
        return {
          key: (item.key as string) ?? "",
          label: (item.label as string) ?? "",
          direction: (item.direction as string) ?? "in",
          letterType: (item.letterType as string) ?? "external",
          resetPolicy: (item.resetPolicy as string) ?? "yearly",
          pattern: format.pattern ?? "",
          serialPad: format.serialPad ?? 5,
        };
      },
      toBody: (form) => ({
        key: form.key,
        label: form.label,
        direction: form.direction,
        letterType: form.letterType,
        resetPolicy: form.resetPolicy,
        format: {
          pattern: String(form.pattern || ""),
          serialPad: Number(form.serialPad) || 5,
        },
      }),
    },
    "distribution-lists": {
      title: "Distribution list",
      description:
        "Google Workspace group addresses memos/circulars are sent to.",
      fields: [
        { key: "name", label: "Name", type: "text", required: true },
        {
          key: "groupEmail",
          label: "Google Group email",
          type: "email",
          required: true,
          placeholder: "all-staff@mapim.org",
        },
        { key: "description", label: "Description", type: "textarea" },
      ],
      columns: [
        { key: "name", label: "Name" },
        { key: "groupEmail", label: "Group email" },
      ],
    },
    "sender-profiles": {
      title: "Sender profile",
      description: "From-name and Reply-To for outbound correspondence.",
      fields: [
        {
          key: "displayName",
          label: "Display name",
          type: "text",
          required: true,
        },
        { key: "replyTo", label: "Reply-To", type: "email" },
      ],
      columns: [
        { key: "displayName", label: "Display name" },
        { key: "replyTo", label: "Reply-To" },
      ],
    },
    "retention-classes": {
      title: "Retention class",
      description: "Retention period and disposition action per class.",
      fields: [
        { key: "name", label: "Name", type: "text", required: true },
        {
          key: "retentionMonths",
          label: "Retention (months)",
          type: "number",
          required: true,
        },
        {
          key: "trigger",
          label: "Trigger",
          type: "select",
          defaultValue: "close",
          options: [
            { value: "close", label: "On close" },
            { value: "fy-end", label: "Fiscal year end" },
          ],
        },
        {
          key: "dispositionAction",
          label: "Disposition",
          type: "select",
          defaultValue: "review",
          options: [
            { value: "review", label: "Review" },
            { value: "destroy", label: "Destroy" },
            { value: "transfer", label: "Transfer to archive" },
            { value: "permanent", label: "Retain permanently" },
          ],
        },
      ],
      columns: [
        { key: "name", label: "Name" },
        { key: "retentionMonths", label: "Months" },
        { key: "dispositionAction", label: "Disposition" },
      ],
    },
    "sla-policies": {
      title: "SLA policy",
      description: "Deadlines (hours) and escalation.",
      fields: [
        { key: "name", label: "Name", type: "text", required: true },
        { key: "ackHours", label: "Acknowledge (hrs)", type: "number" },
        { key: "actionHours", label: "Action (hrs)", type: "number" },
        { key: "approvalHours", label: "Approval (hrs)", type: "number" },
        { key: "escalateToRole", label: "Escalate to role", type: "text" },
      ],
      columns: [
        { key: "name", label: "Name" },
        { key: "ackHours", label: "Ack" },
        { key: "actionHours", label: "Action" },
        { key: "approvalHours", label: "Approval" },
      ],
    },
    signatories: {
      title: "Signatory",
      description: "Who may e-sign outgoing correspondence.",
      fields: [
        {
          key: "userId",
          label: "User",
          type: "select",
          required: true,
          options: userOptions,
        },
      ],
      columns: [
        {
          key: "userId",
          label: "User",
          render: (i) =>
            userOptions.find((o) => o.value === i.userId)?.label ??
            (i.userId as string),
        },
      ],
    },
    templates: {
      title: "Template",
      description: "Drafting templates per letter type (bilingual).",
      fields: [
        {
          key: "letterType",
          label: "Letter type",
          type: "select",
          required: true,
          options: LETTER_TYPES,
        },
        { key: "name", label: "Name", type: "text", required: true },
        {
          key: "lang",
          label: "Language",
          type: "select",
          defaultValue: "en",
          options: [
            { value: "en", label: "English" },
            { value: "bm", label: "Bahasa Melayu" },
          ],
        },
        { key: "bodyHtml", label: "Body", type: "textarea" },
      ],
      columns: [
        { key: "name", label: "Name" },
        { key: "letterType", label: "Type" },
        { key: "lang", label: "Lang" },
      ],
    },
    departments: {
      title: "Department",
      description: "Routing targets for incoming correspondence.",
      fields: [
        { key: "name", label: "Name", type: "text", required: true },
        {
          key: "headUserId",
          label: "Head",
          type: "select",
          defaultValue: "none",
          options: [{ value: "none", label: "— None —" }, ...userOptions],
        },
        { key: "parentId", label: "Parent department id", type: "text" },
      ],
      columns: [
        { key: "name", label: "Name" },
        {
          key: "headUserId",
          label: "Head",
          render: (i) =>
            userOptions.find((o) => o.value === i.headUserId)?.label ?? "—",
        },
      ],
      toForm: (item) => ({
        name: (item.name as string) ?? "",
        headUserId: (item.headUserId as string) ?? "none",
        parentId: (item.parentId as string) ?? "",
      }),
      toBody: (form) => ({
        name: form.name,
        headUserId: form.headUserId === "none" ? null : form.headUserId,
        parentId: form.parentId ? form.parentId : null,
      }),
    },
  };
}

const TABS: { value: string; label: string }[] = [
  { value: "number-schemes", label: "Numbering" },
  { value: "file-plan", label: "File plan" },
  { value: "categories", label: "Categories" },
  { value: "security-labels", label: "Security" },
  { value: "approval-chains", label: "Approval chains" },
  { value: "distribution-lists", label: "Distribution" },
  { value: "sender-profiles", label: "Sender" },
  { value: "retention-classes", label: "Retention" },
  { value: "sla-policies", label: "SLA" },
  { value: "signatories", label: "Signatories" },
  { value: "templates", label: "Templates" },
  { value: "departments", label: "Departments" },
];

function ResourceEditor({
  workspaceId,
  resource,
  spec,
}: {
  workspaceId: string;
  resource: string;
  spec: Spec;
}) {
  const { data: items = [], isLoading } = useConfigList(resource, workspaceId);
  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return (
    <ConfigTable
      workspaceId={workspaceId}
      resource={resource}
      items={items}
      {...spec}
    />
  );
}

export function GeneralManagementSettings({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const { data } = useGetActiveWorkspaceUsers(workspaceId);
  const members = data?.members ?? [];
  const userOptions: Option[] = members.map((member) => ({
    value: member.userId,
    label: member.user?.name ?? member.userId,
  }));
  const specs = buildSpecs(userOptions);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold text-lg">Settings</h2>
        <p className="text-muted-foreground text-sm">
          Configure how correspondence is registered, numbered, classified,
          approved, and retained. Every change is recorded in the audit log.
        </p>
      </div>

      <Tabs defaultValue="number-schemes">
        <TabsList className="flex-wrap">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="pt-4">
          {TABS.map((t) => (
            <TabsContent key={t.value} value={t.value}>
              {t.value === "approval-chains" ? (
                <ApprovalChainsEditor
                  workspaceId={workspaceId}
                  userOptions={userOptions}
                />
              ) : (
                <ResourceEditor
                  workspaceId={workspaceId}
                  resource={t.value}
                  spec={specs[t.value]}
                />
              )}
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </div>
  );
}
