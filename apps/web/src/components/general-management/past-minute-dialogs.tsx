import { useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Lock, Pencil, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useConfirm } from "@/components/ui/confirm";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Committee } from "@/fetchers/committees";
import type { ConfigItem } from "@/fetchers/correspondence";
import {
  type Meeting,
  type MeetingDocumentKind,
  type PastMinuteInput,
  uploadArchivalMeetingDocument,
} from "@/fetchers/meeting";
import { useMeeting } from "@/hooks/queries/meeting/use-meeting";
import {
  useArchivistMutations,
  useMeetingArchivists,
  usePastMinuteMutations,
} from "@/hooks/queries/meeting/use-past-minutes";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import {
  ARCHIVAL_ACCEPT,
  ARCHIVAL_TYPES_LABEL,
  archivalMimeType,
} from "@/lib/archival-upload";
import { formatDateMedium } from "@/lib/format";
import { toast } from "@/lib/toast";
import { MeetingDocuments, meetingDocumentsKey } from "./meeting-documents";

const NONE = "none";

const KIND_OPTIONS: { value: MeetingDocumentKind; label: string }[] = [
  { value: "minutes", label: "Meeting Minutes" },
  { value: "transcript", label: "Transcript" },
  { value: "other", label: "Other" },
];

type PickedFile = { key: string; file: File; kind: MeetingDocumentKind };

type FormState = {
  title: string;
  scheduledAt: string;
  bodyId: string;
  meetingTypeId: string;
  referenceNo: string;
  chairperson: string;
  location: string;
  summary: string;
  confidential: boolean;
};

function initialState(meeting?: Meeting | null): FormState {
  return {
    title: meeting?.title ?? "",
    // The date input wants `YYYY-MM-DD`; the server stores a timestamp.
    scheduledAt: meeting?.scheduledAt ? meeting.scheduledAt.slice(0, 10) : "",
    bodyId: meeting?.bodyId ?? NONE,
    meetingTypeId: meeting?.meetingTypeId ?? NONE,
    referenceNo: meeting?.referenceNo ?? "",
    chairperson: meeting?.chairperson ?? "",
    location: meeting?.location ?? "",
    summary: meeting?.summary ?? "",
    confidential: meeting?.confidential ?? false,
  };
}

function toInput(state: FormState): PastMinuteInput {
  return {
    title: state.title.trim(),
    scheduledAt: state.scheduledAt,
    bodyId: state.bodyId === NONE ? "" : state.bodyId,
    meetingTypeId: state.meetingTypeId === NONE ? "" : state.meetingTypeId,
    referenceNo: state.referenceNo.trim(),
    chairperson: state.chairperson.trim(),
    location: state.location.trim(),
    summary: state.summary.trim(),
    confidential: state.confidential,
  };
}

/**
 * Record a past meeting and upload its documents in one step, or edit an
 * existing one's details (`meeting` set). Documents are uploaded one at a
 * time after the record is saved; if one fails, the record and the files
 * that did upload are kept and the failure is named, so it can be retried
 * from the record itself.
 */
export function PastMinuteFormDialog({
  workspaceId,
  open,
  onClose,
  onSaved,
  committees,
  meetingTypes,
  meeting,
}: {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
  onSaved?: (id: string) => void;
  committees: Committee[];
  meetingTypes: ConfigItem[];
  meeting?: Meeting | null;
}) {
  const editing = Boolean(meeting);
  const qc = useQueryClient();
  const { create, update } = usePastMinuteMutations(workspaceId);
  const [state, setState] = useState<FormState>(() => initialState(meeting));
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = create.isPending || update.isPending || progress !== null;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((s) => ({ ...s, [key]: value }));

  const reset = () => {
    setState(initialState(meeting));
    setFiles([]);
    setProgress(null);
  };

  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const accepted: PickedFile[] = [];
    const refused: string[] = [];
    for (const file of Array.from(list)) {
      if (archivalMimeType(file))
        accepted.push({
          key: `${file.name}-${file.size}-${file.lastModified}`,
          file,
          kind: "minutes",
        });
      else refused.push(file.name);
    }
    if (refused.length)
      toast.error(
        `Only ${ARCHIVAL_TYPES_LABEL} files can be uploaded. Skipped: ${refused.join(", ")}`,
      );
    setFiles((current) => [
      ...current,
      ...accepted.filter((a) => !current.some((c) => c.key === a.key)),
    ]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const submit = async () => {
    const body = toInput(state);
    if (meeting) {
      update.mutate(
        { id: meeting.id, body },
        {
          onSuccess: () => {
            toast.success("Details saved");
            onClose();
          },
        },
      );
      return;
    }

    let created: Meeting;
    try {
      created = await create.mutateAsync(body);
    } catch {
      return; // the mutation's own onError has said why
    }

    const failed: string[] = [];
    for (const [index, picked] of files.entries()) {
      setProgress(
        `Uploading ${index + 1} of ${files.length}: ${picked.file.name}`,
      );
      try {
        await uploadArchivalMeetingDocument(
          workspaceId,
          created.id,
          picked.file,
          picked.kind,
        );
      } catch {
        failed.push(picked.file.name);
      }
    }
    qc.invalidateQueries({ queryKey: ["past-minutes", workspaceId] });
    qc.invalidateQueries({
      queryKey: meetingDocumentsKey(workspaceId, created.id),
    });
    setProgress(null);

    if (failed.length)
      toast.error(
        `Saved, but ${failed.join(", ")} did not upload. Open the record to try again.`,
      );
    else
      toast.success(
        files.length
          ? "Past minute saved. Its documents are being indexed for search."
          : "Past minute saved",
      );
    reset();
    onClose();
    onSaved?.(created.id);
  };

  const valid = Boolean(state.title.trim() && state.scheduledAt);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit past minute" : "Upload past minutes"}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Title" htmlFor="past-title" className="sm:col-span-2">
              <Input
                id="past-title"
                value={state.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="e.g. Mesyuarat Agung Tahunan 2015"
              />
            </Field>
            <Field label="Meeting date" htmlFor="past-date">
              <Input
                id="past-date"
                type="date"
                value={state.scheduledAt}
                onChange={(e) => set("scheduledAt", e.target.value)}
              />
            </Field>
            <Field label="Meeting number / reference" htmlFor="past-ref">
              <Input
                id="past-ref"
                value={state.referenceNo}
                onChange={(e) => set("referenceNo", e.target.value)}
                placeholder="e.g. Kali ke-12, JK/2019/03"
              />
            </Field>
            <Field label="Committee">
              <OptionSelect
                label="Committee"
                value={state.bodyId}
                onChange={(v) => set("bodyId", v)}
                options={committees.map((b) => ({
                  value: b.id,
                  label: b.name,
                }))}
              />
            </Field>
            <Field label="Meeting type">
              <OptionSelect
                label="Meeting type"
                value={state.meetingTypeId}
                onChange={(v) => set("meetingTypeId", v)}
                options={meetingTypes.map((t) => ({
                  value: t.id,
                  label: String(t.label ?? t.id),
                }))}
              />
            </Field>
            <Field label="Chairperson" htmlFor="past-chair">
              <Input
                id="past-chair"
                value={state.chairperson}
                onChange={(e) => set("chairperson", e.target.value)}
                placeholder="Optional"
              />
            </Field>
            <Field label="Location" htmlFor="past-location">
              <Input
                id="past-location"
                value={state.location}
                onChange={(e) => set("location", e.target.value)}
                placeholder="Optional"
              />
            </Field>
            <Field
              label="Summary / notes"
              htmlFor="past-summary"
              className="sm:col-span-2"
            >
              <Textarea
                id="past-summary"
                value={state.summary}
                onChange={(e) => set("summary", e.target.value)}
                placeholder="What the meeting covered. Searchable."
                rows={3}
              />
            </Field>
          </div>
          <label
            className="flex items-center gap-2 text-sm"
            htmlFor="past-confidential"
          >
            <Checkbox
              id="past-confidential"
              checked={state.confidential}
              onCheckedChange={(v) => set("confidential", Boolean(v))}
            />
            <span>
              Confidential: only minutes archivists and global admins can see it
            </span>
          </label>

          {!editing && (
            <div className="space-y-2 rounded-md border border-border border-dashed p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-sm">Documents</p>
                  <p className="text-muted-foreground text-xs">
                    {ARCHIVAL_TYPES_LABEL}. Their text is indexed so search can
                    find it.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => inputRef.current?.click()}
                >
                  <FileText className="h-3.5 w-3.5" />
                  Add files
                </Button>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept={ARCHIVAL_ACCEPT}
                  aria-label="Choose files to upload"
                  className="hidden"
                  onChange={(e) => addFiles(e.target.files)}
                />
              </div>
              {files.length > 0 && (
                <ul className="space-y-1.5">
                  {files.map((picked) => (
                    <li
                      key={picked.key}
                      className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-sm"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">
                        {picked.file.name}
                      </span>
                      <Select
                        value={picked.kind}
                        onValueChange={(v) =>
                          v &&
                          setFiles((all) =>
                            all.map((f) =>
                              f.key === picked.key
                                ? { ...f, kind: v as MeetingDocumentKind }
                                : f,
                            ),
                          )
                        }
                      >
                        <SelectTrigger
                          className="w-40"
                          aria-label={`Type of ${picked.file.name}`}
                        >
                          <SelectValue>
                            {
                              KIND_OPTIONS.find((o) => o.value === picked.kind)
                                ?.label
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {KIND_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <button
                        type="button"
                        aria-label={`Remove ${picked.file.name}`}
                        className="text-muted-foreground hover:text-foreground"
                        disabled={busy}
                        onClick={() =>
                          setFiles((all) =>
                            all.filter((f) => f.key !== picked.key),
                          )
                        }
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {progress && (
                <p
                  className="flex items-center gap-2 text-muted-foreground text-xs"
                  role="status"
                >
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {progress}
                </p>
              )}
            </div>
          )}
        </div>
        <DialogFooter variant="bare">
          <Button variant="ghost" size="sm" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button size="sm" disabled={!valid || busy} onClick={submit}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {editing ? "Save" : "Save past minute"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One past minute: its details and its documents. */
export function PastMinuteDetailDialog({
  workspaceId,
  meetingId,
  canManage,
  onClose,
  committees,
  meetingTypes,
}: {
  workspaceId: string;
  meetingId: string | null;
  canManage: boolean;
  onClose: () => void;
  committees: Committee[];
  meetingTypes: ConfigItem[];
}) {
  const confirm = useConfirm();
  const {
    data: meeting,
    isLoading,
    isError,
  } = useMeeting(workspaceId, meetingId);
  const { remove } = usePastMinuteMutations(workspaceId);
  const [editing, setEditing] = useState(false);

  const committee = committees.find((b) => b.id === meeting?.bodyId)?.name;
  const type = meetingTypes.find((t) => t.id === meeting?.meetingTypeId)?.label;

  const onDelete = async () => {
    if (!meeting) return;
    const ok = await confirm({
      title: "Remove this past minute?",
      description:
        "The record and all of its documents are deleted. This cannot be undone.",
      confirmText: "Remove",
    });
    if (!ok) return;
    remove.mutate(meeting.id, {
      onSuccess: () => {
        toast.success("Past minute removed");
        onClose();
      },
    });
  };

  return (
    <>
      <Dialog open={!!meetingId} onOpenChange={(next) => !next && onClose()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="pr-8">
              {meeting?.title ?? "Past minute"}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[75vh] space-y-5 overflow-y-auto px-6 pb-6">
            {isLoading ? (
              <p
                className="flex items-center gap-2 text-muted-foreground text-sm"
                role="status"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </p>
            ) : isError || !meeting ? (
              <p className="text-destructive text-sm" role="alert">
                Couldn't load this past minute. You may not have access to it.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="success">Archived</Badge>
                  {meeting.confidential && (
                    <Badge variant="destructive" className="gap-1">
                      <Lock className="h-3 w-3" />
                      Confidential
                    </Badge>
                  )}
                  {canManage && (
                    <div className="ml-auto flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(true)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit details
                      </Button>
                      <Button
                        variant="destructive-outline"
                        size="sm"
                        disabled={remove.isPending}
                        onClick={onDelete}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
                <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  <Detail
                    label="Meeting date"
                    value={
                      meeting.scheduledAt
                        ? formatDateMedium(meeting.scheduledAt)
                        : null
                    }
                  />
                  <Detail
                    label="Meeting number / reference"
                    value={meeting.referenceNo}
                  />
                  <Detail label="Committee" value={committee} />
                  <Detail
                    label="Meeting type"
                    value={type ? String(type) : null}
                  />
                  <Detail label="Chairperson" value={meeting.chairperson} />
                  <Detail label="Location" value={meeting.location} />
                </dl>
                {meeting.summary && (
                  <div className="space-y-1">
                    <p className="text-muted-foreground text-xs">
                      Summary / notes
                    </p>
                    <p className="whitespace-pre-wrap text-sm">
                      {meeting.summary}
                    </p>
                  </div>
                )}
                <MeetingDocuments
                  workspaceId={workspaceId}
                  meetingId={meeting.id}
                  canUpload={canManage}
                  canDelete={canManage}
                />
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {meeting && editing && (
        <PastMinuteFormDialog
          workspaceId={workspaceId}
          open={editing}
          onClose={() => setEditing(false)}
          committees={committees}
          meetingTypes={meetingTypes}
          meeting={meeting}
        />
      )}
    </>
  );
}

/** Global admins choose who may upload and maintain Past Minutes. */
export function ArchivistsDialog({
  workspaceId,
  open,
  onClose,
}: {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { data: archivists = [], isLoading } = useMeetingArchivists(
    workspaceId,
    open,
  );
  const { data: usersData } = useGetActiveWorkspaceUsers(workspaceId);
  const { add, remove } = useArchivistMutations(workspaceId);
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState("");

  const candidates = (usersData?.members ?? []).filter(
    (m) => !archivists.some((a) => a.userId === m.userId),
  );
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? candidates.filter((m) =>
        [m.user?.name, m.user?.email].some((f) =>
          f?.toLowerCase().includes(needle),
        ),
      )
    : candidates;
  const toggle = (userId: string, on: boolean) =>
    setPicked((prev) =>
      on ? [...prev, userId] : prev.filter((id) => id !== userId),
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        setPicked([]);
        setFilter("");
        onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Minutes archivists</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-6 pb-6">
          <p className="text-muted-foreground text-sm">
            Archivists can upload, edit and remove Past Minutes, including
            confidential ones. Global admins can always do this. Tick as many
            people as you need.
          </p>
          {candidates.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs" htmlFor="archivist-filter">
                Add people
              </Label>
              <Input
                id="archivist-filter"
                type="search"
                placeholder="Filter by name or email"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <ul className="max-h-52 space-y-0.5 overflow-y-auto rounded-md border border-border p-1">
                {shown.length === 0 ? (
                  <li className="px-2 py-1.5 text-muted-foreground text-sm">
                    No one matches.
                  </li>
                ) : (
                  shown.map((m) => (
                    <li key={m.userId}>
                      {/* biome-ignore lint/a11y/noLabelWithoutControl: Base UI Checkbox renders the control inside */}
                      <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent">
                        <Checkbox
                          aria-label={m.user?.name ?? m.userId}
                          checked={picked.includes(m.userId)}
                          onCheckedChange={(on) => toggle(m.userId, on)}
                        />
                        <span className="min-w-0">
                          <span className="block truncate">
                            {m.user?.name ?? m.userId}
                          </span>
                          {m.user?.email && (
                            <span className="block truncate text-muted-foreground text-xs">
                              {m.user.email}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  ))
                )}
              </ul>
              <Button
                size="sm"
                className="w-full"
                disabled={picked.length === 0 || add.isPending}
                onClick={() =>
                  add.mutate(picked, {
                    onSuccess: () => {
                      setPicked([]);
                      setFilter("");
                    },
                  })
                }
              >
                {picked.length === 0
                  ? "Tick people to add"
                  : `Add ${picked.length} ${picked.length === 1 ? "archivist" : "archivists"}`}
              </Button>
            </div>
          )}
          {archivists.length > 0 && (
            <p className="font-medium text-xs">
              Current archivists ({archivists.length})
            </p>
          )}
          {isLoading ? (
            <p className="text-muted-foreground text-sm" role="status">
              Loading…
            </p>
          ) : archivists.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No archivists yet. Only global admins can upload past minutes.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {archivists.map((a) => (
                <li
                  key={a.userId}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{a.name}</span>
                    <span className="block truncate text-muted-foreground text-xs">
                      {a.email}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(a.userId)}
                    aria-label={`Remove ${a.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <Label className="text-xs" htmlFor={htmlFor}>
        {label}
      </Label>
      {children}
    </div>
  );
}

function Detail({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd>{value || "Not recorded"}</dd>
    </div>
  );
}

function OptionSelect({
  label,
  value,
  onChange,
  options,
  placeholder = "None",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  const selected = options.find((o) => o.value === value)?.label;
  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? NONE)}>
      <SelectTrigger className="w-full" aria-label={label}>
        <SelectValue>{selected ?? placeholder}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{placeholder}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
