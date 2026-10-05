import { Loader2, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { DateField } from "@/components/assets/date-field";
import { Button } from "@/components/ui/button";
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
import type { Letter } from "@/fetchers/correspondence/letters";
import { useConfigList } from "@/hooks/queries/correspondence/use-config";
import { useLetterMediums } from "@/hooks/queries/correspondence/use-mediums";

const toDate = (value: string | null) => (value ? new Date(value) : null);

/**
 * Edits a letter's captured details. Before registration this is a plain
 * edit. After registration it is a *correction*: the reason is required and
 * the change, with its reason, is written to the tamper-evident audit
 * trail. The reference number and attached document are not editable here.
 */
export function LetterEditForm({
  letter,
  workspaceId,
  pending,
  onCancel,
  onSave,
}: {
  letter: Letter;
  workspaceId: string;
  pending: boolean;
  onCancel: () => void;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const registered = Boolean(letter.declaredAt);
  // Outgoing letters record the other party as recipient when they have
  // one; otherwise both directions keep it in the sender fields, as capture
  // does.
  const party: "sender" | "recipient" =
    letter.direction === "out" && letter.recipientName ? "recipient" : "sender";
  const { options: mediums, labelOf } = useLetterMediums(workspaceId);
  const { data: organisations = [] } = useConfigList(
    "organisations",
    workspaceId,
  );

  const [subject, setSubject] = useState(letter.subject);
  const [name, setName] = useState(
    (party === "sender" ? letter.senderName : letter.recipientName) ?? "",
  );
  const [org, setOrg] = useState(
    (party === "sender" ? letter.senderOrg : letter.recipientOrg) ?? "",
  );
  const [email, setEmail] = useState(
    (party === "sender" ? letter.senderEmail : letter.recipientEmail) ?? "",
  );
  const [externalRefNo, setExternalRefNo] = useState(
    letter.externalRefNo ?? "",
  );
  const [fileRef, setFileRef] = useState(letter.fileRef ?? "");
  const [letterDate, setLetterDate] = useState(toDate(letter.letterDate));
  const [receivedAt, setReceivedAt] = useState(toDate(letter.receivedAt));
  const [urgency, setUrgency] = useState(letter.urgency || "normal");
  const [organisationId, setOrganisationId] = useState(
    letter.organisationId ?? "",
  );
  const [medium, setMedium] = useState<string>(letter.medium);
  const [reason, setReason] = useState("");

  // The current medium stays selectable even if it has since been retired.
  const mediumOptions = mediums.some((m) => m.value === letter.medium)
    ? mediums
    : [{ value: letter.medium, label: labelOf(letter.medium) }, ...mediums];

  const ready = subject.trim() !== "" && (!registered || reason.trim() !== "");

  return (
    <form
      className="space-y-3 rounded-xl border border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        const prefix = party;
        onSave({
          subject: subject.trim(),
          [`${prefix}Name`]: name.trim(),
          [`${prefix}Org`]: org.trim(),
          [`${prefix}Email`]: email.trim(),
          externalRefNo: externalRefNo.trim(),
          fileRef: fileRef.trim(),
          letterDate: letterDate ? letterDate.toISOString() : undefined,
          receivedAt: receivedAt ? receivedAt.toISOString() : undefined,
          urgency,
          ...(organisationId ? { organisationId } : {}),
          medium,
          ...(registered ? { correctionReason: reason.trim() } : {}),
        });
      }}
    >
      <h4 className="font-medium text-sm">
        {registered ? "Correct letter details" : "Edit letter details"}
      </h4>
      {registered && (
        <div className="flex gap-2 rounded-md bg-amber-500/10 p-2.5 text-amber-800 text-xs dark:text-amber-200">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>
            This letter is registered as {letter.refNo}. A correction keeps the
            reference number and the attached document, and is recorded in the
            audit trail with your reason.
          </span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="edit-subject">
            Subject <span className="text-destructive">*</span>
          </Label>
          <Input
            id="edit-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-name">
            {party === "sender" ? "Sender name" : "Recipient name"}
          </Label>
          <Input
            id="edit-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-org">
            {party === "sender"
              ? "Sender organisation"
              : "Recipient organisation"}
          </Label>
          <Input
            id="edit-org"
            value={org}
            onChange={(e) => setOrg(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-email">
            {party === "sender" ? "Sender email" : "Recipient email"}
          </Label>
          <Input
            id="edit-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-extref">External ref. no.</Label>
          <Input
            id="edit-extref"
            value={externalRefNo}
            onChange={(e) => setExternalRefNo(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-fileref">File ref</Label>
          <Input
            id="edit-fileref"
            value={fileRef}
            onChange={(e) => setFileRef(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Medium</Label>
          <Select value={medium} onValueChange={(v) => v && setMedium(v)}>
            <SelectTrigger aria-label="Medium">
              <SelectValue>{labelOf(medium)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {mediumOptions.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Letter date</Label>
          <DateField value={letterDate} onChange={setLetterDate} />
        </div>
        <div className="space-y-1.5">
          <Label>{letter.direction === "in" ? "Received" : "Sent"}</Label>
          <DateField value={receivedAt} onChange={setReceivedAt} />
        </div>
        <div className="space-y-1.5">
          <Label>Urgency</Label>
          <Select value={urgency} onValueChange={(v) => v && setUrgency(v)}>
            <SelectTrigger aria-label="Urgency">
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
        <div className="space-y-1.5">
          <Label>Organisation</Label>
          <Select
            value={organisationId}
            onValueChange={(v) => v && setOrganisationId(v)}
          >
            <SelectTrigger aria-label="Organisation">
              <SelectValue>
                {String(
                  organisations.find((o) => o.id === organisationId)?.label ??
                    "—",
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {organisations.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {String(o.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {registered && (
        <div className="space-y-1.5">
          <Label htmlFor="edit-reason">
            Reason for the correction{" "}
            <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="edit-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Sender's name was mistyped at capture"
          />
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!ready || pending}>
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {registered ? "Save correction" : "Save"}
        </Button>
      </div>
    </form>
  );
}

export default LetterEditForm;
