import { useQueryClient } from "@tanstack/react-query";
import {
  ClipboardList,
  Download,
  FileText,
  Info,
  Link2,
  Loader2,
  Paperclip,
  Route as RouteIcon,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { DateField } from "@/components/assets/date-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  type LetterDetail,
  uploadLetterAttachment,
} from "@/fetchers/correspondence/letters";
import { useConfigList } from "@/hooks/queries/correspondence/use-config";
import {
  useLetter,
  useLetterMutations,
} from "@/hooks/queries/correspondence/use-letters";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { formatDateMedium } from "@/lib/format";
import { toast } from "@/lib/toast";

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
          />
        </DialogSidebarPanel>
        <DialogSidebarPanel value="minutes">
          <MinutesSection letter={letter} m={m} userName={userName} />
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
        <DialogSidebarPanel value="linked">
          <div className="space-y-2">
            {letter.links.length === 0 && (
              <p className="text-muted-foreground text-sm">
                No linked letters.
              </p>
            )}
            {letter.links.map((l) => (
              <div
                key={l.id}
                className="rounded-md border border-border px-3 py-2 text-sm"
              >
                <span className="text-muted-foreground">{l.relation}: </span>
                {l.toLetterId}
              </div>
            ))}
          </div>
        </DialogSidebarPanel>
      </DialogSidebar>
    </>
  );
}

type Mutations = ReturnType<typeof useLetterMutations>;

function OverviewSection({
  letter,
  m,
  categories,
  securityLabels,
  categoryLabel,
  securityLabel,
}: {
  letter: LetterDetail;
  m: Mutations;
  categories: { id: string; label?: unknown }[];
  securityLabels: { id: string; label?: unknown }[];
  categoryLabel: string;
  securityLabel: string;
}) {
  const [categoryId, setCategoryId] = useState(letter.categoryId ?? "");
  const [securityLabelId, setSecurityLabelId] = useState(
    letter.securityLabelId ?? "",
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {!letter.declaredAt && (
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
        <Select
          value={letter.status}
          onValueChange={(v) => m.setStatus.mutate(v)}
        >
          <SelectTrigger className="w-48">
            <SelectValue>{letter.status}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

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
          label="Received"
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
    </div>
  );
}

function MinutesSection({
  letter,
  m,
  userName,
}: {
  letter: LetterDetail;
  m: Mutations;
  userName: (id: string | null) => string;
}) {
  const [body, setBody] = useState("");
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {letter.minutes.length === 0 && (
          <p className="text-muted-foreground text-sm">No minutes yet.</p>
        )}
        {letter.minutes.map((minute) => (
          <div
            key={minute.id}
            className="rounded-md border border-border px-3 py-2"
          >
            <div className="mb-1 flex items-center justify-between text-muted-foreground text-xs">
              <span>{userName(minute.authorId)}</span>
              <span>{formatDateMedium(minute.createdAt)}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm">{minute.body}</p>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <Textarea
          value={body}
          placeholder="Add a minute / instruction…"
          onChange={(e) => setBody(e.target.value)}
        />
        <Button
          size="sm"
          disabled={!body.trim() || m.addMinute.isPending}
          onClick={() =>
            m.addMinute.mutate(
              { body: body.trim() },
              { onSuccess: () => setBody("") },
            )
          }
        >
          Add minute
        </Button>
      </div>
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
              <Badge className="border text-xs">{a.status}</Badge>
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

  const upload = async (file: File) => {
    setUploading(true);
    try {
      await uploadLetterAttachment(workspaceId, letter.id, file);
      toast.success("Attachment uploaded");
      qc.invalidateQueries({ queryKey: ["letter", workspaceId, letter.id] });
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {letter.attachments.length === 0 && (
          <p className="text-muted-foreground text-sm">No attachments.</p>
        )}
        {letter.attachments.map((att) => (
          <div
            key={att.id}
            className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
          >
            <span className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              {att.filename}
              {att.id === letter.primaryAttachmentId && (
                <Badge className="border text-xs">primary</Badge>
              )}
            </span>
            <a
              href={attachmentDownloadUrl(workspaceId, letter.id, att.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground"
            >
              <Download className="h-4 w-4" />
            </a>
          </div>
        ))}
      </div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
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
