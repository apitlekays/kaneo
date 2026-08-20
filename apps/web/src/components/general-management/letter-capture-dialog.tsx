import { Loader2, Paperclip } from "lucide-react";
import { type ReactNode, useState } from "react";
import { DateField } from "@/components/assets/date-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  linkLetter,
  uploadLetterAttachment,
} from "@/fetchers/correspondence/letters";
import { useConfigList } from "@/hooks/queries/correspondence/use-config";
import { useLetterMutations } from "@/hooks/queries/correspondence/use-letters";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { usePdfCompression } from "@/hooks/use-pdf-compression";
import { compressionLabel } from "@/lib/compression-label";
import { isPdfUpload } from "@/lib/is-pdf-upload";
import { toast } from "@/lib/toast";
import { LetterLinkPicker, type PendingLink } from "./letter-link-picker";

const TYPES = [
  { value: "external", label: "External" },
  { value: "memo", label: "Memo" },
  { value: "circular", label: "Circular" },
];
const MEDIUMS = [
  { value: "email", label: "Email" },
  { value: "physical", label: "Physical" },
  { value: "hand", label: "By hand" },
  { value: "portal", label: "Portal" },
];

export function LetterCaptureDialog({
  workspaceId,
  defaultDirection = "in",
  trigger,
}: {
  workspaceId: string;
  defaultDirection?: "in" | "out";
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const m = useLetterMutations(workspaceId);
  const { data: categories = [] } = useConfigList("categories", workspaceId);
  const { data: securityLabels = [] } = useConfigList(
    "security-labels",
    workspaceId,
  );
  const { data: organisations = [] } = useConfigList(
    "organisations",
    workspaceId,
  );
  const { data: usersData } = useGetActiveWorkspaceUsers(workspaceId);
  const users = usersData?.members ?? [];

  const [direction, setDirection] = useState<"in" | "out">(defaultDirection);
  const [type, setType] = useState("external");
  const [medium, setMedium] = useState("email");
  const [subject, setSubject] = useState("");
  const [senderName, setSenderName] = useState("");
  const [senderOrg, setSenderOrg] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [letterDate, setLetterDate] = useState<Date | null>(null);
  const [receivedAt, setReceivedAt] = useState<Date | null>(new Date());
  const [categoryId, setCategoryId] = useState("");
  const [securityLabelId, setSecurityLabelId] = useState("");
  const [externalRefNo, setExternalRefNo] = useState("");
  const [urgency, setUrgency] = useState("normal");
  const [organisationId, setOrganisationId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const compression = usePdfCompression();

  // Links are held locally because the letter being linked FROM has no id
  // until create resolves — see postLinks below.
  const [pendingLinks, setPendingLinks] = useState<PendingLink[]>([]);
  const [failedLinks, setFailedLinks] = useState<PendingLink[]>([]);
  const [totalLinksAttempted, setTotalLinksAttempted] = useState(0);
  // What the failure banner names the letter by — subject, not a reference
  // number, because capture never allocates one (registration does, later).
  const [capturedSubject, setCapturedSubject] = useState<string | null>(null);
  const [createdLetterId, setCreatedLetterId] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  const reset = () => {
    setDirection(defaultDirection);
    setType("external");
    setMedium("email");
    setSubject("");
    setSenderName("");
    setSenderOrg("");
    setSenderEmail("");
    setLetterDate(null);
    setReceivedAt(new Date());
    setCategoryId("");
    setSecurityLabelId("");
    setExternalRefNo("");
    setUrgency("normal");
    setOrganisationId("");
    setAssigneeId("");
    setFile(null);
    compression.reset();
    setPendingLinks([]);
    setFailedLinks([]);
    setTotalLinksAttempted(0);
    setCapturedSubject(null);
    setCreatedLetterId(null);
    setLinking(false);
  };

  // Posts a batch of links against `newLetterId` and reports which ones
  // failed. Promise.allSettled so one rejection never stops the others from
  // being attempted.
  const postLinks = async (newLetterId: string, links: PendingLink[]) => {
    const settled = await Promise.allSettled(
      links.map((link) =>
        linkLetter(workspaceId, newLetterId, {
          toLetterId: link.toLetterId,
          relation: link.relation,
        }),
      ),
    );
    return links.filter((_, i) => settled[i].status === "rejected");
  };

  const retryFailedLinks = async () => {
    if (!createdLetterId) return;
    setLinking(true);
    const stillFailed = await postLinks(createdLetterId, failedLinks);
    setLinking(false);
    setFailedLinks(stillFailed);
    if (stillFailed.length === 0) {
      reset();
      setOpen(false);
    }
  };

  const closeAfterFailure = () => {
    // The letter is already captured — closing here never touches it.
    reset();
    setOpen(false);
  };

  // Escape, backdrop click and the header X all route through here, same as
  // the Close button — otherwise this single, never-remounted dialog would
  // reopen showing a stale failure banner from the previous submission.
  // Dismissal is never blocked; we just make sure it leaves a clean form.
  const handleOpenChange = (next: boolean) => {
    if (!next && failedLinks.length > 0) {
      const count = failedLinks.length;
      reset();
      toast.error(
        `${count} link${count === 1 ? "" : "s"} could not be saved, but the letter was captured and is safe.`,
      );
    }
    setOpen(next);
  };

  const submit = () => {
    if (!subject.trim() || !organisationId) return;
    m.create.mutate(
      {
        direction,
        type,
        medium,
        subject: subject.trim(),
        senderName: senderName.trim() || undefined,
        senderOrg: senderOrg.trim() || undefined,
        senderEmail: senderEmail.trim() || undefined,
        letterDate: letterDate?.toISOString(),
        receivedAt: receivedAt?.toISOString(),
        categoryId: categoryId || undefined,
        securityLabelId: securityLabelId || undefined,
        externalRefNo: externalRefNo.trim() || undefined,
        urgency,
        organisationId: organisationId || undefined,
        assigneeId: assigneeId || undefined,
      },
      {
        onSuccess: async (letter) => {
          if (file) {
            setUploading(true);
            try {
              await uploadLetterAttachment(
                workspaceId,
                letter.id,
                compression.result?.file ?? file,
              );
            } catch {
              toast.error("Letter saved, but the attachment upload failed");
            } finally {
              setUploading(false);
            }
          }

          // Never roll back the created letter past this point. It is
          // already captured — a real row, tracked in the pending-
          // registration queue — even though it has no reference number
          // yet (that's assigned later, at registration/dispatch). A
          // failed link is recoverable; deleting a captured letter is not
          // something this app supports or should start doing here.
          if (pendingLinks.length > 0) {
            setLinking(true);
            const failed = await postLinks(letter.id, pendingLinks);
            setLinking(false);
            if (failed.length > 0) {
              setCreatedLetterId(letter.id);
              setTotalLinksAttempted(pendingLinks.length);
              setFailedLinks(failed);
              setCapturedSubject(letter.subject);
              return;
            }
          }

          reset();
          setOpen(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Register correspondence</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 px-6 pb-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Direction</Label>
            <Select
              value={direction}
              onValueChange={(v) => setDirection(v as "in" | "out")}
            >
              <SelectTrigger>
                <SelectValue>
                  {direction === "in"
                    ? "Incoming (Masuk)"
                    : "Outgoing (Keluar)"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="in">Incoming (Masuk)</SelectItem>
                <SelectItem value="out">Outgoing (Keluar)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue>
                  {TYPES.find((t) => t.value === type)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Medium</Label>
            <Select value={medium} onValueChange={setMedium}>
              <SelectTrigger>
                <SelectValue>
                  {MEDIUMS.find((mm) => mm.value === medium)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {MEDIUMS.map((mm) => (
                  <SelectItem key={mm.value} value={mm.value}>
                    {mm.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{direction === "in" ? "Received" : "Sent"}</Label>
            <DateField value={receivedAt} onChange={setReceivedAt} />
          </div>
          <div className="space-y-1.5">
            <Label>Urgency</Label>
            <Select value={urgency} onValueChange={setUrgency}>
              <SelectTrigger>
                <SelectValue>
                  {urgency === "urgent" ? "Urgent" : "Normal"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>
              Subject <span className="text-destructive">*</span>
            </Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject of the letter"
            />
          </div>
          <div className="space-y-1.5">
            <Label>External ref. no.</Label>
            <Input
              value={externalRefNo}
              onChange={(e) => setExternalRefNo(e.target.value)}
              placeholder="Reference no. on the incoming letter"
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              {direction === "in" ? "Sender name" : "Recipient name"}
            </Label>
            <Input
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              {direction === "in"
                ? "Sender organisation"
                : "Recipient organisation"}
            </Label>
            <Input
              value={senderOrg}
              onChange={(e) => setSenderOrg(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input
              type="email"
              value={senderEmail}
              onChange={(e) => setSenderEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Letter date</Label>
            <DateField value={letterDate} onChange={setLetterDate} />
          </div>
          <div className="space-y-1.5">
            <Label>
              Owning organisation <span className="text-destructive">*</span>
            </Label>
            <Select value={organisationId} onValueChange={setOrganisationId}>
              <SelectTrigger>
                <SelectValue>
                  {(organisations.find((org) => org.id === organisationId)
                    ?.label as string) ?? "—"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {organisations.map((org) => (
                  <SelectItem key={org.id} value={org.id}>
                    {org.label as string}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue>
                  {(categories.find((cat) => cat.id === categoryId)
                    ?.label as string) ?? "—"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.label as string}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Security</Label>
            <Select value={securityLabelId} onValueChange={setSecurityLabelId}>
              <SelectTrigger>
                <SelectValue>
                  {(securityLabels.find((s) => s.id === securityLabelId)
                    ?.label as string) ?? "—"}
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
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Assign to (Main User)</Label>
            <Select value={assigneeId} onValueChange={setAssigneeId}>
              <SelectTrigger>
                <SelectValue>
                  {users.find((u) => u.userId === assigneeId)?.user?.name ??
                    "Unassigned"}
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
            <p className="text-muted-foreground text-xs">
              The Main User is notified by email and in their Home →
              Correspondence to inspect this letter.
            </p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Attachment (scan / email PDF)</Label>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-muted/40">
              <Paperclip className="h-4 w-4" />
              {file ? file.name : "Choose a file…"}
              <input
                type="file"
                className="hidden"
                accept="application/pdf,.pdf"
                onChange={(e) => {
                  const picked = e.target.files?.[0] ?? null;
                  if (picked && !isPdfUpload(picked)) {
                    toast.error("Only PDF files can be attached to a letter");
                    e.target.value = "";
                    return;
                  }
                  setFile(picked);
                  if (picked) {
                    // A failed run leaves result null, so the original uploads.
                    compression.run(picked).catch(() => {});
                  } else {
                    compression.reset();
                  }
                }}
              />
            </label>
            {compression.busy && (
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
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
            {!compression.busy && compression.result && (
              <p className="text-muted-foreground text-xs">
                {compressionLabel(compression.result)}
              </p>
            )}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Links to other letters</Label>
            <LetterLinkPicker
              workspaceId={workspaceId}
              value={pendingLinks}
              onChange={setPendingLinks}
            />
          </div>
          {failedLinks.length > 0 ? (
            <div className="flex flex-col gap-3 sm:col-span-2">
              <p className="text-sm text-destructive" role="alert">
                Letter "{capturedSubject}" was captured. {failedLinks.length} of{" "}
                {totalLinksAttempted} links could not be saved.
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  disabled={linking}
                  onClick={closeAfterFailure}
                >
                  Close
                </Button>
                <Button disabled={linking} onClick={retryFailedLinks}>
                  {linking && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Retry
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="hidden sm:col-span-2 sm:block" />
              <div className="flex justify-end gap-2 sm:col-span-2">
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  disabled={
                    !subject.trim() ||
                    !organisationId ||
                    m.create.isPending ||
                    uploading ||
                    linking ||
                    compression.busy
                  }
                  onClick={submit}
                >
                  {(m.create.isPending || uploading || linking) && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  Capture
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
