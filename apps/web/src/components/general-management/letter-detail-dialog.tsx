import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { VariantProps } from "class-variance-authority";
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Download,
  FileText,
  Info,
  Link2,
  Loader2,
  Paperclip,
  PenSquare,
  Route as RouteIcon,
  Send,
  Signature as SignatureIcon,
  Stamp,
  Upload,
  UserCheck,
} from "lucide-react";
import { useRef, useState } from "react";
import { DateField } from "@/components/assets/date-field";
import { Badge, type badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DialogSidebar,
  DialogSidebarPanel,
} from "@/components/ui/dialog-sidebar";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  attachmentDownloadUrl,
  attachmentPreviewUrl,
  dispositionCertificateUrl,
  type Letter,
  type LetterDetail,
  uploadLetterAttachment,
  verifySignature,
} from "@/fetchers/correspondence/letters";
import { getMyPageAccess } from "@/fetchers/workspace-access";
import { useConfigList } from "@/hooks/queries/correspondence/use-config";
import {
  useLetter,
  useLetterMutations,
  useLetters,
} from "@/hooks/queries/correspondence/use-letters";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { usePdfCompression } from "@/hooks/use-pdf-compression";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";
import { compressionLabel } from "@/lib/compression-label";
import { formatDateMedium } from "@/lib/format";
import { isPdfUpload } from "@/lib/is-pdf-upload";
import { letterReference } from "@/lib/letter-reference";
import { toast } from "@/lib/toast";
import { urgencyBadge } from "@/lib/urgency";
import {
  type ExistingLink,
  LetterLinkPicker,
  type PendingLink,
} from "./letter-link-picker";
import { MinuteThread } from "./minute-thread";

const STATUSES = [
  "captured",
  "registered",
  "classified",
  "assigned",
  "in-action",
  "awaiting-response",
  "closed",
  "archived",
];

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-sm">{value || "—"}</div>
    </div>
  );
}

export function LetterDetailDialog({
  workspaceId,
  letterId,
  onClose,
}: {
  workspaceId: string;
  letterId: string | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useLetter(workspaceId, letterId);
  const [section, setSection] = useState("overview");

  return (
    <Dialog
      open={Boolean(letterId)}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setSection("overview");
        }
      }}
    >
      <DialogContent className="flex h-[85dvh] max-w-4xl flex-col overflow-hidden">
        {isLoading || !data ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Body
            workspaceId={workspaceId}
            letter={data}
            section={section}
            setSection={setSection}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  workspaceId,
  letter,
  section,
  setSection,
}: {
  workspaceId: string;
  letter: LetterDetail;
  section: string;
  setSection: (v: string) => void;
}) {
  const m = useLetterMutations(workspaceId, letter.id);
  const { data: categories = [] } = useConfigList("categories", workspaceId);
  const { data: securityLabels = [] } = useConfigList(
    "security-labels",
    workspaceId,
  );
  const { data: usersData } = useGetActiveWorkspaceUsers(workspaceId);
  const users = usersData?.members ?? [];
  const userName = (id: string | null) =>
    id ? (users.find((u) => u.userId === id)?.user?.name ?? id) : "—";
  const labelOf = (
    list: { id: string; label?: unknown }[],
    id: string | null,
  ) => (id ? ((list.find((x) => x.id === id)?.label as string) ?? "—") : "—");
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id ?? "";
  const isOutgoing = letter.direction === "out";
  const { data: access } = useQuery({
    queryKey: ["page-access", "me", workspaceId],
    queryFn: () => getMyPageAccess(workspaceId),
    enabled: !!workspaceId,
  });
  const isAdmin = access?.isAdmin ?? false;

  return (
    <>
      <DialogHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 pr-10">
          <div className="min-w-0">
            <DialogTitle className="truncate">{letter.subject}</DialogTitle>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
              <span className="font-mono">
                {letter.refNo ?? "unregistered"}
              </span>
              <Badge className="border">{letter.status}</Badge>
              {(() => {
                const badge = urgencyBadge(letter.urgency);
                return badge ? (
                  <Badge
                    variant={
                      badge.variant as VariantProps<
                        typeof badgeVariants
                      >["variant"]
                    }
                    className="text-xs"
                  >
                    {badge.label}
                  </Badge>
                ) : null;
              })()}
              <span>{letter.direction === "in" ? "Masuk" : "Keluar"}</span>
              <span>{letter.type}</span>
            </div>
          </div>
        </div>
      </DialogHeader>

      <DialogSidebar
        value={section}
        onValueChange={setSection}
        items={[
          { value: "overview", label: "Overview", icon: Info },
          ...(isOutgoing
            ? [
                {
                  value: "draft",
                  label: "Draft",
                  icon: PenSquare,
                  badge: letter.versions.length || "",
                },
                {
                  value: "approvals",
                  label: "Approvals",
                  icon: Stamp,
                },
                {
                  value: "signature",
                  label: "Signature",
                  icon: SignatureIcon,
                },
                {
                  value: "dispatch",
                  label: "Dispatch",
                  icon: Send,
                  badge: letter.dispatches.length || "",
                },
              ]
            : []),
          {
            value: "minutes",
            label: "Minutes",
            icon: ClipboardList,
            badge: letter.minutes.length || "",
          },
          {
            value: "routing",
            label: "Routing",
            icon: RouteIcon,
            badge: letter.assignments.length || "",
          },
          {
            value: "attachments",
            label: "Attachments",
            icon: Paperclip,
            badge: letter.attachments.length || "",
          },
          {
            value: "linked",
            label: "Linked",
            icon: Link2,
            badge: letter.links.length || "",
          },
          { value: "retention", label: "Retention", icon: Archive },
        ]}
      >
        <DialogSidebarPanel value="overview">
          <OverviewSection
            letter={letter}
            m={m}
            categories={categories}
            securityLabels={securityLabels}
            categoryLabel={labelOf(categories, letter.categoryId)}
            securityLabel={labelOf(securityLabels, letter.securityLabelId)}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
          />
        </DialogSidebarPanel>
        {isOutgoing && (
          <DialogSidebarPanel value="draft">
            <DraftSection letter={letter} m={m} userName={userName} />
          </DialogSidebarPanel>
        )}
        {isOutgoing && (
          <DialogSidebarPanel value="approvals">
            <ApprovalsSection
              letter={letter}
              m={m}
              currentUserId={currentUserId}
              userName={userName}
            />
          </DialogSidebarPanel>
        )}
        {isOutgoing && (
          <DialogSidebarPanel value="signature">
            <SignatureSection
              workspaceId={workspaceId}
              letter={letter}
              m={m}
              currentUserId={currentUserId}
              userName={userName}
            />
          </DialogSidebarPanel>
        )}
        {isOutgoing && (
          <DialogSidebarPanel value="dispatch">
            <DispatchSection workspaceId={workspaceId} letter={letter} m={m} />
          </DialogSidebarPanel>
        )}
        <DialogSidebarPanel value="minutes">
          <MinutesSection
            workspaceId={workspaceId}
            letter={letter}
            m={m}
            users={users}
            userName={userName}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
          />
        </DialogSidebarPanel>
        <DialogSidebarPanel value="routing">
          <RoutingSection
            letter={letter}
            m={m}
            users={users}
            userName={userName}
          />
        </DialogSidebarPanel>
        <DialogSidebarPanel value="attachments">
          <AttachmentsSection workspaceId={workspaceId} letter={letter} />
        </DialogSidebarPanel>
        <DialogSidebarPanel value="retention">
          <RetentionSection
            workspaceId={workspaceId}
            letter={letter}
            m={m}
            isAdmin={isAdmin}
            userName={userName}
          />
        </DialogSidebarPanel>
        <DialogSidebarPanel value="linked">
          <LinkedSection workspaceId={workspaceId} letter={letter} m={m} />
        </DialogSidebarPanel>
      </DialogSidebar>
    </>
  );
}

type Mutations = ReturnType<typeof useLetterMutations>;

// Handling statuses the Main User may set; registry statuses stay GM-only.
const ASSIGNEE_STATUS_OPTIONS = ["in-action", "awaiting-response"];

// "superseded" is set when routing replaces an open pending assignment;
// give it a readable label instead of showing the raw status value.
function assignmentStatusLabel(status: string): string {
  return status === "superseded" ? "Superseded" : status;
}

function OverviewSection({
  letter,
  m,
  categories,
  securityLabels,
  categoryLabel,
  securityLabel,
  currentUserId,
  isAdmin,
}: {
  letter: LetterDetail;
  m: Mutations;
  categories: { id: string; label?: unknown }[];
  securityLabels: { id: string; label?: unknown }[];
  categoryLabel: string;
  securityLabel: string;
  currentUserId: string;
  isAdmin: boolean;
}) {
  const confirm = useConfirm();
  const [categoryId, setCategoryId] = useState(letter.categoryId ?? "");
  const [securityLabelId, setSecurityLabelId] = useState(
    letter.securityLabelId ?? "",
  );
  const [rejectingAssignmentId, setRejectingAssignmentId] = useState<
    string | null
  >(null);
  const [rejectNote, setRejectNote] = useState("");

  const pendingForMe = letter.assignments.find(
    (a) => a.status === "pending" && a.toUserId === currentUserId,
  );

  const isMainUser = letter.currentAssigneeId === currentUserId;
  const canSetStatus = isAdmin || isMainUser;
  // Non-close transitions available in the dropdown (closing goes via the
  // guarded Close button). GM officers get the full lifecycle minus "closed".
  const statusOptions: string[] = isAdmin
    ? STATUSES.filter((s) => s !== "closed")
    : ASSIGNEE_STATUS_OPTIONS;

  const actionMinutes = letter.minutes.filter((mn) => mn.assigneeId);
  const totalActions = actionMinutes.length;
  const openActions = actionMinutes.filter(
    (mn) => mn.status !== "done" && mn.status !== "cancelled",
  ).length;
  const doneActions = totalActions - openActions;
  const isClosed = letter.status === "closed" || letter.status === "archived";

  const closeCorrespondence = async () => {
    if (
      await confirm({
        title: "Close correspondence?",
        description:
          "This marks the matter concluded and stamps the closed date, which starts the retention clock. You can reopen it later if needed.",
        confirmText: "Close",
        destructive: false,
      })
    )
      m.setStatus.mutate("closed");
  };

  return (
    <div className="space-y-5">
      {pendingForMe && (
        <div className="space-y-2 rounded-md border border-border bg-muted/40 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm">
              You have been assigned this letter. Accept to become its Main
              User.
            </span>
            <span className="flex gap-2">
              <Button
                size="sm"
                disabled={m.acceptAssignment.isPending}
                onClick={() => m.acceptAssignment.mutate(pendingForMe.id)}
              >
                Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={m.rejectAssignment.isPending}
                onClick={() =>
                  setRejectingAssignmentId(
                    rejectingAssignmentId === pendingForMe.id
                      ? null
                      : pendingForMe.id,
                  )
                }
              >
                Reject
              </Button>
            </span>
          </div>
          {rejectingAssignmentId === pendingForMe.id && (
            <div className="flex flex-wrap items-end gap-2">
              <Input
                className="w-64"
                value={rejectNote}
                placeholder="Reason for rejecting (optional)"
                onChange={(e) => setRejectNote(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={m.rejectAssignment.isPending}
                onClick={() =>
                  m.rejectAssignment.mutate(
                    {
                      assignmentId: pendingForMe.id,
                      note: rejectNote.trim() || undefined,
                    },
                    {
                      onSuccess: () => {
                        setRejectingAssignmentId(null);
                        setRejectNote("");
                      },
                    },
                  )
                }
              >
                Confirm reject
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRejectingAssignmentId(null);
                  setRejectNote("");
                }}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {isAdmin && !letter.declaredAt && (
          <Button
            size="sm"
            disabled={m.register.isPending}
            onClick={() => m.register.mutate(undefined)}
          >
            {m.register.isPending && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            Register &amp; assign ref no
          </Button>
        )}
        {canSetStatus && !isClosed && (
          <Select
            value={
              statusOptions.includes(letter.status) ? letter.status : undefined
            }
            onValueChange={(v) => m.setStatus.mutate(v)}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder={`Status: ${letter.status}`}>
                {letter.status}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {canSetStatus &&
          (isClosed ? (
            isAdmin && (
              <Button
                size="sm"
                variant="outline"
                disabled={m.setStatus.isPending}
                onClick={() => m.setStatus.mutate("in-action")}
              >
                Reopen
              </Button>
            )
          ) : (
            <Button
              size="sm"
              disabled={m.setStatus.isPending || openActions > 0}
              onClick={closeCorrespondence}
              title={
                openActions > 0
                  ? `${openActions} action(s) still open`
                  : undefined
              }
            >
              Close correspondence
            </Button>
          ))}
      </div>

      {totalActions > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
          <span>
            Actions: <span className="font-medium">{doneActions}</span>/
            {totalActions} done
          </span>
          {openActions > 0 && !isClosed && (
            <span className="text-muted-foreground text-xs">
              — close is available once all actions are done
            </span>
          )}
          {openActions === 0 && !isClosed && (
            <Badge variant="success" className="ml-auto text-xs">
              Ready to close
            </Badge>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Reference no." value={letter.refNo} />
        <Field label="File ref" value={letter.fileRef} />
        <Field
          label={letter.direction === "in" ? "Sender" : "Recipient"}
          value={letter.senderName ?? letter.recipientName}
        />
        <Field
          label="Organisation"
          value={letter.senderOrg ?? letter.recipientOrg}
        />
        <Field label="Medium" value={letter.medium} />
        <Field
          label={letter.direction === "in" ? "Received" : "Sent"}
          value={letter.receivedAt ? formatDateMedium(letter.receivedAt) : "—"}
        />
        <Field
          label="Letter date"
          value={letter.letterDate ? formatDateMedium(letter.letterDate) : "—"}
        />
        <Field
          label="Declared"
          value={letter.declaredAt ? formatDateMedium(letter.declaredAt) : "—"}
        />
        <Field label="Category" value={categoryLabel} />
        <Field label="Security" value={securityLabel} />
        <Field
          label="Integrity hash"
          value={
            letter.contentHash ? (
              <span className="break-all font-mono text-xs">
                {letter.contentHash.slice(0, 24)}…
              </span>
            ) : (
              "—"
            )
          }
        />
      </div>

      {isAdmin && (
        <div className="space-y-2 rounded-xl border border-border p-4">
          <h4 className="font-medium text-sm">Classification</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue>
                  {(categories.find((c) => c.id === categoryId)
                    ?.label as string) ?? "Category"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label as string}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={securityLabelId} onValueChange={setSecurityLabelId}>
              <SelectTrigger>
                <SelectValue>
                  {(securityLabels.find((s) => s.id === securityLabelId)
                    ?.label as string) ?? "Security"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {securityLabels.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label as string}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={m.classify.isPending}
            onClick={() =>
              m.classify.mutate({
                categoryId: categoryId || undefined,
                securityLabelId: securityLabelId || undefined,
              })
            }
          >
            Save classification
          </Button>
        </div>
      )}
    </div>
  );
}

function MinutesSection({
  workspaceId,
  letter,
  m,
  users,
  userName,
  currentUserId,
  isAdmin,
}: {
  workspaceId: string;
  letter: LetterDetail;
  m: Mutations;
  users: { userId: string; user?: { name?: string } }[];
  userName: (id: string | null) => string;
  currentUserId: string;
  isAdmin: boolean;
}) {
  const [body, setBody] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueAt, setDueAt] = useState<Date | null>(null);
  // The Main User (current assignee) may delegate; GM officers always may.
  const canDelegate = isAdmin || letter.currentAssigneeId === currentUserId;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {letter.minutes.length === 0 && (
          <p className="text-muted-foreground text-sm">No minutes yet.</p>
        )}
        {letter.minutes.map((minute) => {
          const isAction = Boolean(minute.assigneeId);
          const done = minute.status === "done";
          const canComplete =
            isAction &&
            !done &&
            (isAdmin || minute.assigneeId === currentUserId);
          return (
            <div
              key={minute.id}
              className="rounded-md border border-border px-3 py-2"
            >
              <div className="mb-1 flex items-center justify-between text-muted-foreground text-xs">
                <span>{userName(minute.authorId)}</span>
                <span>{formatDateMedium(minute.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm">{minute.body}</p>
              {isAction && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge className="flex items-center gap-1 border text-xs">
                    <UserCheck className="h-3 w-3" />
                    {userName(minute.assigneeId)}
                  </Badge>
                  <Badge
                    variant={done ? "success" : "outline"}
                    className="text-xs"
                  >
                    {done ? "Done" : "Open"}
                  </Badge>
                  {minute.dueAt && !done && (
                    <span className="text-muted-foreground text-xs">
                      Due {formatDateMedium(minute.dueAt)}
                    </span>
                  )}
                  {done && minute.completedAt && (
                    <span className="text-muted-foreground text-xs">
                      Completed {formatDateMedium(minute.completedAt)}
                    </span>
                  )}
                  {canComplete && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto h-7"
                      disabled={m.completeMinute.isPending}
                      onClick={() => m.completeMinute.mutate(minute.id)}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Mark done
                    </Button>
                  )}
                </div>
              )}
              <MinuteThread
                workspaceId={workspaceId}
                letterId={letter.id}
                minute={minute}
                canPost={isAdmin || minute.assigneeId === currentUserId}
                attachments={letter.attachments}
              />
            </div>
          );
        })}
      </div>
      {canDelegate ? (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <h4 className="font-medium text-sm">Minute / delegate an action</h4>
          <Textarea
            value={body}
            placeholder="Instruction or note…"
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Select value={assigneeId} onValueChange={setAssigneeId}>
              <SelectTrigger>
                <SelectValue>
                  {assigneeId
                    ? (users.find((u) => u.userId === assigneeId)?.user?.name ??
                      assigneeId)
                    : "No assignee (note only)"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.userId} value={u.userId}>
                    {u.user?.name ?? u.userId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DateField
              value={dueAt}
              onChange={setDueAt}
              placeholder="Action due date"
            />
          </div>
          {assigneeId && (
            <p className="text-muted-foreground text-xs">
              This becomes an action for {userName(assigneeId)}, who is notified
              by email and in their Home → Correspondence.
            </p>
          )}
          <Button
            size="sm"
            disabled={!body.trim() || m.addMinute.isPending}
            onClick={() =>
              m.addMinute.mutate(
                {
                  body: body.trim(),
                  assigneeId: assigneeId || undefined,
                  dueAt: assigneeId ? dueAt?.toISOString() : undefined,
                },
                {
                  onSuccess: () => {
                    setBody("");
                    setAssigneeId("");
                    setDueAt(null);
                  },
                },
              )
            }
          >
            {assigneeId ? "Assign action" : "Add minute"}
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Only the Main User or a GM officer can minute actions on this letter.
        </p>
      )}
    </div>
  );
}

function RoutingSection({
  letter,
  m,
  users,
  userName,
}: {
  letter: LetterDetail;
  m: Mutations;
  users: { userId: string; user?: { name?: string } }[];
  userName: (id: string | null) => string;
}) {
  const [toUserId, setToUserId] = useState("");
  const [dueAt, setDueAt] = useState<Date | null>(null);
  const [note, setNote] = useState("");
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {letter.assignments.length === 0 && (
          <p className="text-muted-foreground text-sm">Not routed yet.</p>
        )}
        {letter.assignments.map((a) => (
          <div
            key={a.id}
            className="rounded-md border border-border px-3 py-2 text-sm"
          >
            <div className="flex items-center justify-between">
              <span>To {userName(a.toUserId)}</span>
              <Badge className="border text-xs">
                {assignmentStatusLabel(a.status)}
              </Badge>
            </div>
            {a.note && <p className="text-muted-foreground">{a.note}</p>}
            {a.dueAt && (
              <p className="text-muted-foreground text-xs">
                Due {formatDateMedium(a.dueAt)}
              </p>
            )}
          </div>
        ))}
      </div>
      <div className="space-y-3 rounded-xl border border-border p-4">
        <h4 className="font-medium text-sm">Assign / route</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select value={toUserId} onValueChange={setToUserId}>
            <SelectTrigger>
              <SelectValue>
                {users.find((u) => u.userId === toUserId)?.user?.name ??
                  "Select officer"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {users.map((u) => (
                <SelectItem key={u.userId} value={u.userId}>
                  {u.user?.name ?? u.userId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DateField value={dueAt} onChange={setDueAt} placeholder="Due date" />
        </div>
        <Input
          value={note}
          placeholder="Instruction (optional)"
          onChange={(e) => setNote(e.target.value)}
        />
        <Button
          size="sm"
          disabled={!toUserId || m.route.isPending}
          onClick={() =>
            m.route.mutate(
              {
                toUserId,
                note: note.trim() || undefined,
                dueAt: dueAt?.toISOString(),
              },
              {
                onSuccess: () => {
                  setToUserId("");
                  setNote("");
                  setDueAt(null);
                },
              },
            )
          }
        >
          Route
        </Button>
      </div>
    </div>
  );
}

// Names a link the way the register does, but distinguishes an outbound
// link ("this letter replies to X") from an inbound one ("X replies to
// this letter") — showing both as "Reply" would misstate who answered
// whom.
function linkLabel(relation: string, outbound: boolean, ref: string): string {
  if (relation === "reply")
    return outbound ? `Reply to ${ref}` : `Replied to by ${ref}`;
  if (relation === "supersedes")
    return outbound ? `Supersedes ${ref}` : `Superseded by ${ref}`;
  return `Related to ${ref}`;
}

function LinkedSection({
  workspaceId,
  letter,
  m,
}: {
  workspaceId: string;
  letter: LetterDetail;
  m: Mutations;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  // The letters list endpoint returns every letter in the workspace, so the
  // same cache entry LetterLinkPicker uses resolves link rows to a
  // reference/subject without a per-row fetch.
  const { data: letters = [] } = useLetters(workspaceId, {});
  const lettersById = new Map<string, Letter>(letters.map((l) => [l.id, l]));
  const [pendingLinks, setPendingLinks] = useState<PendingLink[]>([]);
  const [adding, setAdding] = useState(false);

  // I2: seed the picker's exclusion from the links the letter already has,
  // so straight after linking it doesn't re-offer the same counterpart
  // under the same relation — there is no delete route for a link, so a
  // duplicate produced that way is permanent. Same (toLetterId, relation)
  // resolution as the outbound/inbound rendering above: the counterpart is
  // `toLetterId` on the outbound half of a link, `fromLetterId` on the
  // inbound half.
  const alreadyLinked: ExistingLink[] = letter.links.map((l) => {
    const outbound = l.outbound ?? true;
    return {
      toLetterId: outbound ? l.toLetterId : l.fromLetterId,
      relation: l.relation as ExistingLink["relation"],
    };
  });

  const addLinks = async () => {
    if (pendingLinks.length === 0) return;
    const links = pendingLinks;
    setPendingLinks([]);
    setAdding(true);
    try {
      await Promise.allSettled(
        links.map((link) =>
          m.link.mutateAsync({
            toLetterId: link.toLetterId,
            relation: link.relation,
          }),
        ),
      );
    } finally {
      setAdding(false);
      qc.invalidateQueries({ queryKey: ["letter", workspaceId, letter.id] });
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {letter.links.length === 0 && (
          <p className="text-muted-foreground text-sm">No linked letters.</p>
        )}
        {letter.links.map((l) => {
          const outbound = l.outbound ?? true;
          const counterpartId = outbound ? l.toLetterId : l.fromLetterId;
          const counterpart = lettersById.get(counterpartId);
          const ref = counterpart
            ? letterReference(counterpart)
            : counterpartId;
          return (
            <a
              key={l.id}
              href={`/dashboard/correspondence/${counterpartId}`}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)
                  return;
                e.preventDefault();
                navigate({ to: `/dashboard/correspondence/${counterpartId}` });
              }}
              className="block rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
            >
              <div className="text-muted-foreground text-xs">
                {linkLabel(l.relation, outbound, ref)}
              </div>
              {counterpart && (
                <div className="truncate">{counterpart.subject}</div>
              )}
            </a>
          );
        })}
      </div>
      <div className="space-y-2 rounded-xl border border-border p-4">
        <h4 className="font-medium text-sm">Link to another letter</h4>
        <LetterLinkPicker
          workspaceId={workspaceId}
          value={pendingLinks}
          onChange={setPendingLinks}
          excludeId={letter.id}
          alreadyLinked={alreadyLinked}
        />
        <Button
          size="sm"
          disabled={pendingLinks.length === 0 || adding}
          onClick={addLinks}
        >
          {adding && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Add
        </Button>
      </div>
    </div>
  );
}

function AttachmentsSection({
  workspaceId,
  letter,
}: {
  workspaceId: string;
  letter: LetterDetail;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const compression = usePdfCompression();
  const [previewing, setPreviewing] = useState<string | null>(
    letter.primaryAttachmentId ?? null,
  );

  const upload = async (file: File) => {
    setUploading(true);
    let toUpload = file;
    let note: string | null = null;
    try {
      const outcome = await compression.run(file);
      toUpload = outcome.file;
      note = compressionLabel(outcome);
    } catch {
      // Compression is best-effort; fall back to the file as chosen.
    }
    try {
      await uploadLetterAttachment(workspaceId, letter.id, toUpload);
      toast.success(
        note ? `Attachment uploaded — ${note}` : "Attachment uploaded",
      );
      qc.invalidateQueries({ queryKey: ["letter", workspaceId, letter.id] });
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
      compression.reset();
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {letter.attachments.length === 0 && (
          <p className="text-muted-foreground text-sm">No attachments.</p>
        )}
        {letter.attachments.map((att) => {
          const isPdf = att.mimeType === "application/pdf";
          const open = previewing === att.id;
          return (
            <div
              key={att.id}
              className="rounded-md border border-border text-sm"
            >
              <div className="flex items-center justify-between px-3 py-2">
                <span className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  {att.filename}
                  {att.id === letter.primaryAttachmentId && (
                    <Badge className="border text-xs">primary</Badge>
                  )}
                </span>
                <span className="flex items-center gap-3">
                  {isPdf && (
                    <button
                      type="button"
                      onClick={() => setPreviewing(open ? null : att.id)}
                      className="text-muted-foreground hover:text-foreground"
                      title={open ? "Hide preview" : "Preview"}
                    >
                      {open ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                  )}
                  <a
                    href={attachmentDownloadUrl(workspaceId, letter.id, att.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                </span>
              </div>
              {isPdf && open && (
                <iframe
                  title={att.filename}
                  src={attachmentPreviewUrl(workspaceId, letter.id, att.id)}
                  className="h-[60vh] w-full border-border border-t"
                />
              )}
            </div>
          );
        })}
      </div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept="application/pdf,.pdf"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && !isPdfUpload(file)) {
            toast.error("Only PDF files can be attached to a letter");
          } else if (file) {
            upload(file);
          }
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
      {compression.busy && (
        <div className="flex items-center gap-2 pb-2 text-muted-foreground text-xs">
          <Loader2 className="h-3 w-3 animate-spin" />
          {compression.progress
            ? `Compressing… page ${compression.progress.page} of ${compression.progress.total}`
            : "Compressing…"}
          <button
            type="button"
            className="underline hover:text-foreground"
            onClick={compression.cancel}
          >
            Cancel
          </button>
        </div>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Upload className="h-3.5 w-3.5" />
        )}
        Upload attachment
      </Button>
    </div>
  );
}

function DraftSection({
  letter,
  m,
  userName,
}: {
  letter: LetterDetail;
  m: Mutations;
  userName: (id: string | null) => string;
}) {
  const latest = letter.versions[letter.versions.length - 1];
  const [body, setBody] = useState(latest?.bodyHtml ?? "");
  const canSubmit = ["draft", "captured"].includes(letter.status);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs">Draft body</Label>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Compose the outgoing letter…"
          className="min-h-40"
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={m.saveDraft.isPending}
            onClick={() => m.saveDraft.mutate(body)}
          >
            Save version
          </Button>
          {canSubmit && (
            <Button
              size="sm"
              disabled={m.submitReview.isPending}
              onClick={() => m.submitReview.mutate()}
            >
              Submit for review
            </Button>
          )}
        </div>
      </div>
      {letter.versions.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-xs">Version history</Label>
          {[...letter.versions].reverse().map((ver) => (
            <div
              key={ver.id}
              className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-xs"
            >
              <span>v{ver.version}</span>
              <span className="text-muted-foreground">
                {userName(ver.createdBy)} · {formatDateMedium(ver.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ApprovalsSection({
  letter,
  m,
  currentUserId,
  userName,
}: {
  letter: LetterDetail;
  m: Mutations;
  currentUserId: string;
  userName: (id: string | null) => string;
}) {
  const [comment, setComment] = useState("");
  const isDrafter = letter.createdBy === currentUserId;
  const approval = letter.approval;
  const currentStep = approval?.steps.find((s) => s.status === "pending");

  const Label2 = ({ children }: { children: React.ReactNode }) => (
    <Label className="text-xs">{children}</Label>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border p-4 text-sm">
        <span className="text-muted-foreground">Status: </span>
        <span className="font-medium">{letter.status}</span>
        {approval?.chainName && (
          <span className="text-muted-foreground">
            {" "}
            · chain: {approval.chainName}
          </span>
        )}
      </div>

      {/* Maker–checker review */}
      {letter.status === "in-review" && (
        <div className="space-y-2 rounded-xl border border-border p-4">
          <h4 className="font-medium text-sm">Review</h4>
          {isDrafter ? (
            <p className="text-muted-foreground text-sm">
              Awaiting a reviewer — you can't review your own draft.
            </p>
          ) : (
            <>
              <Textarea
                value={comment}
                placeholder="Comment (optional)"
                onChange={(e) => setComment(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={m.reviewDecision.isPending}
                  onClick={() =>
                    m.reviewDecision.mutate({ decision: "approve", comment })
                  }
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={m.reviewDecision.isPending}
                  onClick={() =>
                    m.reviewDecision.mutate({ decision: "return", comment })
                  }
                >
                  Return to drafter
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Approval chain steps */}
      {approval && (
        <div className="space-y-2">
          {approval.steps.map((step) => (
            <div
              key={step.id}
              className="space-y-2 rounded-xl border border-border p-4"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">
                  Step {step.stepOrder} · {step.approverType}
                  {step.quorum > 1 ? ` · quorum ${step.quorum}` : ""}
                </span>
                <Badge className="border text-xs">{step.status}</Badge>
              </div>
              {step.approverType === "users" && (
                <p className="text-muted-foreground text-xs">
                  Approvers: {step.approverRefs.map(userName).join(", ")}
                </p>
              )}
              {step.decisions && step.decisions.length > 0 && (
                <ul className="space-y-0.5 text-muted-foreground text-xs">
                  {step.decisions.map((d) => (
                    <li key={`${d.userId}-${d.at}`}>
                      {userName(d.userId)}: {d.decision}
                      {d.comment ? ` — ${d.comment}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {currentStep?.id === step.id &&
                letter.status === "approving" &&
                !isDrafter && (
                  <div className="space-y-2 border-border border-t pt-2">
                    <Label2>Your decision</Label2>
                    <Textarea
                      value={comment}
                      placeholder="Comment (optional)"
                      onChange={(e) => setComment(e.target.value)}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={m.approvalDecision.isPending}
                        onClick={() =>
                          m.approvalDecision.mutate({
                            stepInstanceId: step.id,
                            decision: "approve",
                            comment,
                          })
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={m.approvalDecision.isPending}
                        onClick={() =>
                          m.approvalDecision.mutate({
                            stepInstanceId: step.id,
                            decision: "return",
                            comment,
                          })
                        }
                      >
                        Return
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={m.approvalDecision.isPending}
                        onClick={() =>
                          m.approvalDecision.mutate({
                            stepInstanceId: step.id,
                            decision: "reject",
                            comment,
                          })
                        }
                      >
                        Reject
                      </Button>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      Only listed approvers can decide; the server enforces
                      this.
                    </p>
                  </div>
                )}
            </div>
          ))}
        </div>
      )}

      {!approval && letter.status !== "in-review" && (
        <p className="text-muted-foreground text-sm">
          No approval in progress. Submit the draft for review to begin.
        </p>
      )}
    </div>
  );
}

function SignatureSection({
  workspaceId,
  letter,
  m,
  currentUserId,
  userName,
}: {
  workspaceId: string;
  letter: LetterDetail;
  m: Mutations;
  currentUserId: string;
  userName: (id: string | null) => string;
}) {
  const [verify, setVerify] = useState<{ ok: boolean; reason?: string } | null>(
    null,
  );
  const [verifying, setVerifying] = useState(false);
  const sig = letter.signature;
  const isDrafter = letter.createdBy === currentUserId;
  const signedAttachment = letter.attachments.find(
    (a) => a.kind === "signed-final",
  );

  const runVerify = async () => {
    setVerifying(true);
    try {
      setVerify(await verifySignature(workspaceId, letter.id));
    } catch {
      setVerify({ ok: false, reason: "verify-error" });
    } finally {
      setVerifying(false);
    }
  };

  if (sig) {
    return (
      <div className="space-y-3">
        <div className="space-y-1.5 rounded-xl border border-border p-4 text-sm">
          <div>
            Signed by{" "}
            <span className="font-medium">
              {sig.manifest?.signerName ?? userName(sig.signerId)}
            </span>
            {sig.manifest?.role ? ` · ${sig.manifest.role}` : ""}
          </div>
          <div className="text-muted-foreground text-xs">
            {formatDateMedium(sig.signedAt)} · {sig.method}
          </div>
          <div className="break-all font-mono text-muted-foreground text-xs">
            SHA-256 {sig.signedHash?.slice(0, 40)}…
          </div>
          {sig.manifest?.certSubject && (
            <div className="text-muted-foreground text-xs">
              Certificate: {sig.manifest.certSubject}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {signedAttachment && (
            <a
              href={attachmentDownloadUrl(
                workspaceId,
                letter.id,
                signedAttachment.id,
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button size="sm" variant="outline">
                <Download className="h-3.5 w-3.5" /> Signed PDF
              </Button>
            </a>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={verifying}
            onClick={runVerify}
          >
            {verifying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Verify signature
          </Button>
        </div>
        {verify && (
          <p
            className={
              verify.ok
                ? "text-emerald-600 text-sm dark:text-emerald-400"
                : "text-rose-600 text-sm dark:text-rose-400"
            }
          >
            {verify.ok
              ? "✓ Signature valid — document intact."
              : `⚠ Verification failed (${verify.reason ?? "unknown"}).`}
          </p>
        )}
      </div>
    );
  }

  if (letter.status === "approved") {
    return isDrafter ? (
      <p className="text-muted-foreground text-sm">
        Awaiting an authorized signatory — you can't sign your own letter.
      </p>
    ) : (
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">
          This letter is approved and ready to sign. Only authorized signatories
          can sign; the server enforces this.
        </p>
        <Button
          size="sm"
          disabled={m.sign.isPending}
          onClick={() => m.sign.mutate()}
        >
          {m.sign.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Sign letter
        </Button>
      </div>
    );
  }

  return (
    <p className="text-muted-foreground text-sm">
      The letter must be approved before it can be signed.
    </p>
  );
}

function DispatchSection({
  workspaceId,
  letter,
  m,
}: {
  workspaceId: string;
  letter: LetterDetail;
  m: Mutations;
}) {
  const { data: lists = [] } = useConfigList("distribution-lists", workspaceId);
  const [method, setMethod] = useState<
    "group" | "email" | "post" | "courier" | "hand"
  >("group");
  const [listIds, setListIds] = useState<string[]>([]);
  const [emails, setEmails] = useState("");
  const [trackingNo, setTrackingNo] = useState("");
  const [coverNote, setCoverNote] = useState("");

  const toggleList = (id: string) =>
    setListIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const canDispatch = letter.status === "signed";
  const submit = () => {
    const body: Parameters<typeof m.dispatch.mutate>[0] = {
      method,
      coverNote: coverNote.trim() || undefined,
    };
    if (method === "group") body.distributionListIds = listIds;
    if (method === "email")
      body.recipients = emails
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean)
        .map((email) => ({ email }));
    if (method === "post" || method === "courier")
      body.trackingNo = trackingNo.trim() || undefined;
    m.dispatch.mutate(body);
  };

  return (
    <div className="space-y-4">
      {letter.dispatches.length > 0 && (
        <div className="space-y-2">
          {letter.dispatches.map((d) => (
            <div
              key={d.id}
              className="rounded-md border border-border px-3 py-2 text-sm"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{d.method}</span>
                <Badge className="border text-xs">
                  {d.deliveryStatus ?? "—"}
                </Badge>
              </div>
              <p className="text-muted-foreground text-xs">
                {formatDateMedium(d.dispatchedAt)}
                {d.trackingNo ? ` · tracking ${d.trackingNo}` : ""}
                {d.providerMessageId ? ` · msg ${d.providerMessageId}` : ""}
              </p>
            </div>
          ))}
        </div>
      )}

      {!canDispatch ? (
        <p className="text-muted-foreground text-sm">
          {letter.status === "dispatched"
            ? "This letter has been dispatched."
            : "The letter must be signed before dispatch."}
        </p>
      ) : (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <h4 className="font-medium text-sm">Dispatch</h4>
          <Select
            value={method}
            onValueChange={(v) => setMethod(v as typeof method)}
          >
            <SelectTrigger>
              <SelectValue>{method}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="group">Google Group(s)</SelectItem>
              <SelectItem value="email">Email recipients</SelectItem>
              <SelectItem value="post">Post</SelectItem>
              <SelectItem value="courier">Courier</SelectItem>
              <SelectItem value="hand">By hand</SelectItem>
            </SelectContent>
          </Select>

          {method === "group" && (
            <div className="flex flex-wrap gap-1.5">
              {lists.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => toggleList(l.id)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs",
                    listIds.includes(l.id)
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {l.name as string}
                </button>
              ))}
              {lists.length === 0 && (
                <span className="text-muted-foreground text-xs">
                  No distribution lists — add them in Settings.
                </span>
              )}
            </div>
          )}
          {method === "email" && (
            <Input
              value={emails}
              placeholder="comma-separated recipient emails"
              onChange={(e) => setEmails(e.target.value)}
            />
          )}
          {(method === "post" || method === "courier") && (
            <Input
              value={trackingNo}
              placeholder="Tracking number (optional)"
              onChange={(e) => setTrackingNo(e.target.value)}
            />
          )}
          <Textarea
            value={coverNote}
            placeholder="Cover note (optional)"
            onChange={(e) => setCoverNote(e.target.value)}
          />
          <Button
            size="sm"
            disabled={
              m.dispatch.isPending ||
              (method === "group" && listIds.length === 0) ||
              (method === "email" && !emails.trim())
            }
            onClick={submit}
          >
            {m.dispatch.isPending && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            Dispatch
          </Button>
        </div>
      )}
    </div>
  );
}

function RetentionSection({
  workspaceId,
  letter,
  m,
  isAdmin,
  userName,
}: {
  workspaceId: string;
  letter: LetterDetail;
  m: Mutations;
  isAdmin: boolean;
  userName: (id: string | null) => string;
}) {
  const { data: classes = [] } = useConfigList(
    "retention-classes",
    workspaceId,
  );
  const [classId, setClassId] = useState(letter.retentionClassId ?? "");
  const [holdReason, setHoldReason] = useState("");
  const [dispAction, setDispAction] = useState<
    "destroy" | "transfer" | "permanent" | "review"
  >("review");
  const [dispNote, setDispNote] = useState("");
  const openHold = letter.holds.find((h) => !h.releasedAt);
  const disposed = letter.dispositionStatus;

  return (
    <div className="space-y-4">
      {/* Retention class */}
      <div className="space-y-2 rounded-xl border border-border p-4">
        <h4 className="font-medium text-sm">Retention</h4>
        <div className="flex flex-wrap items-end gap-2">
          <Select value={classId} onValueChange={setClassId}>
            <SelectTrigger className="w-56">
              <SelectValue>
                {(classes.find((cl) => cl.id === classId)?.name as string) ??
                  "Select class"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {classes.map((cl) => (
                <SelectItem key={cl.id} value={cl.id}>
                  {cl.name as string} ({cl.retentionMonths as number} mo)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={!classId || m.setRetention.isPending}
            onClick={() => m.setRetention.mutate(classId)}
          >
            Save
          </Button>
        </div>
      </div>

      {/* Legal hold */}
      <div className="space-y-2 rounded-xl border border-border p-4">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-sm">Legal hold</h4>
          {letter.legalHold && (
            <Badge className="border text-xs text-rose-600">On hold</Badge>
          )}
        </div>
        {letter.legalHold ? (
          <>
            {openHold && (
              <p className="text-muted-foreground text-sm">
                {openHold.reason} · by {userName(openHold.placedBy)}
              </p>
            )}
            {isAdmin && (
              <Button
                size="sm"
                variant="outline"
                disabled={m.releaseHold.isPending}
                onClick={() => m.releaseHold.mutate()}
              >
                Release hold
              </Button>
            )}
          </>
        ) : isAdmin ? (
          <div className="flex flex-wrap items-end gap-2">
            <Input
              className="w-64"
              value={holdReason}
              placeholder="Reason for hold"
              onChange={(e) => setHoldReason(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!holdReason.trim() || m.placeHold.isPending}
              onClick={() =>
                m.placeHold.mutate(holdReason.trim(), {
                  onSuccess: () => setHoldReason(""),
                })
              }
            >
              Place hold
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Not under hold.</p>
        )}
      </div>

      {/* Disposition */}
      <div className="space-y-2 rounded-xl border border-border p-4">
        <h4 className="font-medium text-sm">Disposition</h4>
        {disposed ? (
          <div className="space-y-2 text-sm">
            <div>
              Dispositioned: <span className="font-medium">{disposed}</span>
            </div>
            {letter.dispositions[0]?.certificateObjectKey && (
              <a
                href={dispositionCertificateUrl(workspaceId, letter.id)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button size="sm" variant="outline">
                  <Download className="h-3.5 w-3.5" /> Certificate
                </Button>
              </a>
            )}
          </div>
        ) : isAdmin ? (
          <div className="space-y-2">
            {letter.legalHold && (
              <p className="text-muted-foreground text-xs">
                Release the legal hold before disposing.
              </p>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <Select
                value={dispAction}
                onValueChange={(v) => setDispAction(v as typeof dispAction)}
              >
                <SelectTrigger className="w-44">
                  <SelectValue>{dispAction}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="review">Review</SelectItem>
                  <SelectItem value="destroy">Destroy</SelectItem>
                  <SelectItem value="transfer">Transfer to archive</SelectItem>
                  <SelectItem value="permanent">Retain permanently</SelectItem>
                </SelectContent>
              </Select>
              <Input
                className="w-56"
                value={dispNote}
                placeholder="Note (optional)"
                onChange={(e) => setDispNote(e.target.value)}
              />
              <Button
                size="sm"
                variant="destructive"
                disabled={letter.legalHold || m.dispose.isPending}
                onClick={() =>
                  m.dispose.mutate({
                    action: dispAction,
                    note: dispNote.trim() || undefined,
                  })
                }
              >
                Authorize disposition
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            Only a records manager can authorize disposition.
          </p>
        )}
      </div>
    </div>
  );
}
