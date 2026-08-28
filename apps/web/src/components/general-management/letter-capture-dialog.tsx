import { Loader2, Paperclip } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
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
import { onSelectValueChange } from "@/lib/select-value";
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
  // The dialog is mounted once and never remounted, so an async write that
  // started while it was open (a link post, or a retry) can still resolve
  // after the user has since dismissed the dialog, or dismissed AND
  // reopened it to capture something else entirely. A boolean "is it open
  // now" can't tell those two cases apart — reopening makes it true again,
  // so a late result from the PREVIOUS submission would look current. `gen`
  // is a generation counter bumped on every open-state transition; each
  // submission captures its own generation up front and, after any await,
  // compares it against the live one to tell whether it's still the
  // submission the user is looking at.
  //
  // A stale generation is not by itself a reason to reset the form, though
  // — the dialog may since have been reopened and be mid-entry on a
  // different letter, and clearing it out from under the user reproduces
  // the exact harm this whole mechanism exists to prevent. What decides
  // whether resetting is safe is whether the dialog is *currently closed*
  // (an already-captured letter's populated form left behind, inviting a
  // duplicate Capture) — a second, separate piece of state from `gen`.
  // Reading `open` directly here would not work: a value closed over at
  // render time, not the live value, is exactly what made the old
  // `openRef`-only version of this bug possible in the first place.
  const gen = useRef(0);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
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
    const mine = gen.current;
    setLinking(true);
    const stillFailed = await postLinks(createdLetterId, failedLinks);
    setLinking(false);
    // The user may have dismissed the dialog (Escape, backdrop, header X, or
    // Close) while this was in flight — or dismissed it AND reopened it to
    // capture something else. Either way this result belongs to a
    // submission that is no longer the one on screen: never repopulate
    // failedLinks or touch setOpen, which could otherwise close a dialog
    // the user has since reopened for a different letter. Only reset the
    // form if the dialog is currently closed — that's an already-captured
    // letter's populated form left behind, inviting a duplicate Capture.
    // If it's open again, the user may be mid-entry on something new;
    // clearing it out from under them is the exact harm this guard exists
    // to prevent, so leave it untouched. Either way, surface the outcome as
    // a toast — a failed link must not vanish unseen just because it's not
    // safe to reset.
    if (gen.current !== mine) {
      if (!openRef.current) reset();
      if (stillFailed.length > 0) {
        const count = stillFailed.length;
        toast.error(
          `${count} link${count === 1 ? "" : "s"} could not be saved, but the letter was captured and is safe.`,
        );
      }
      return;
    }
    setFailedLinks(stillFailed);
    if (stillFailed.length === 0) {
      reset();
      // R1 audit: same reasoning as closeAfterFailure — a direct setOpen
      // that has to bump gen itself since it isn't routed through
      // handleOpenChange. No live race today (Retry is disabled while
      // `linking`, so nothing else for this generation can be in flight
      // when this line runs), but kept consistent with the counter's
      // stated contract rather than leaving another quiet gap.
      gen.current += 1;
      setOpen(false);
    }
  };

  const closeAfterFailure = () => {
    // The letter is already captured — closing here never touches it.
    reset();
    // R1 audit: this is a direct setOpen, not handleOpenChange, so it has
    // to bump gen itself. Nothing is provably racing it right now — Close
    // is disabled while `linking`, and failedLinks (which is what makes
    // this button reachable at all) can only be populated once the
    // initial post has already resolved — but the counter's whole contract
    // is "bumped on every open-state transition", and this closes the
    // dialog. Leaving it unbumped is exactly the kind of gap that let
    // Cancel silently regress; a future change to Close's disabled
    // condition, or a new concurrent action, could reopen the same class
    // of bug here. Not routed through handleOpenChange itself: that would
    // also re-run its own reset()+toast-on-failedLinks branch against the
    // stale (pre-reset) `failedLinks` closure value, showing a duplicate
    // toast this button has never shown.
    gen.current += 1;
    setOpen(false);
  };

  // Escape, backdrop click and the header X all route through here, same as
  // the Close button — otherwise this single, never-remounted dialog would
  // reopen showing a stale failure banner from the previous submission.
  // Dismissal is never blocked; we just make sure it leaves a clean form.
  const handleOpenChange = (next: boolean) => {
    gen.current += 1;
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
    // R2: captured here, before the create request is even sent — not as
    // the first line of onSuccess, which only runs once that request has
    // already resolved. A dismiss + reopen that happens DURING the create
    // (not after it) would otherwise be invisible to onSuccess: it would
    // read gen.current only after the reopen had already bumped it, so its
    // own submission would look current when it is not.
    const mine = gen.current;
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
          let failed: PendingLink[] = [];
          if (pendingLinks.length > 0) {
            setLinking(true);
            failed = await postLinks(letter.id, pendingLinks);
            setLinking(false);
          }

          // R3: this check used to live *inside* the `pendingLinks.length >
          // 0` block above, so a letter captured with an attachment and no
          // links skipped it entirely — the attachment upload above awaits
          // just as long as a link post does, and a dismiss + reopen during
          // it fell straight through to the unconditional reset()/
          // setOpen(false) below with a stale generation. Runs after BOTH
          // possible awaits (the upload, the link post — either, neither,
          // or both may have happened), so it covers every path through
          // this handler, not just the one with pending links.
          //
          // The user may have dismissed the dialog (Cancel, Escape,
          // backdrop, or header X) while any of that was in flight, or
          // dismissed it AND reopened it to start a different letter.
          // failedLinks is still [] at this point, so handleOpenChange's
          // reset-on-close guard never fired; there is no stale failure
          // state for it to have cleaned up. Never touch setOpen or write
          // banner state here: the dialog may already be closed, or
          // reopened for a different letter entirely. Only reset the form
          // if it's currently closed (an already-captured letter's
          // populated form left behind, inviting a duplicate Capture) — if
          // it's open again the user may be mid-entry on a new letter, and
          // clearing that out from under them is the exact harm this guard
          // exists to prevent. Either way, a failed link must not vanish
          // unseen just because it's not safe to reset, so say so via toast
          // regardless.
          if (gen.current !== mine) {
            if (!openRef.current) reset();
            if (failed.length > 0) {
              const count = failed.length;
              toast.error(
                `${count} link${count === 1 ? "" : "s"} could not be saved, but the letter was captured and is safe.`,
              );
            }
            return;
          }
          if (failed.length > 0) {
            setCreatedLetterId(letter.id);
            setTotalLinksAttempted(pendingLinks.length);
            setFailedLinks(failed);
            setCapturedSubject(letter.subject);
            return;
          }

          reset();
          // R1 audit: same reasoning as closeAfterFailure/retryFailedLinks
          // — a direct setOpen that has to bump gen itself. Only reached
          // once the stale check above has already confirmed this is
          // still the current generation, so nothing downstream of this
          // point depends on gen for correctness within this call; bumped
          // anyway to keep the counter's contract ("bumped on every
          // open-state transition") true for whatever comes next.
          gen.current += 1;
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
            <Select
              value={type}
              onValueChange={(value) => value !== null && setType(value)}
            >
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
            <Select
              value={medium}
              onValueChange={(value) => value !== null && setMedium(value)}
            >
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
            <Select
              value={urgency}
              onValueChange={(value) => value !== null && setUrgency(value)}
            >
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
            <Select
              value={organisationId}
              onValueChange={onSelectValueChange(setOrganisationId)}
            >
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
            <Select
              value={categoryId}
              onValueChange={onSelectValueChange(setCategoryId)}
            >
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
            <Select
              value={securityLabelId}
              onValueChange={onSelectValueChange(setSecurityLabelId)}
            >
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
            <Select
              value={assigneeId}
              onValueChange={onSelectValueChange(setAssigneeId)}
            >
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
                <Button
                  variant="outline"
                  onClick={() => handleOpenChange(false)}
                >
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
