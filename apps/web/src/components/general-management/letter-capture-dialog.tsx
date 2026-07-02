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
import { uploadLetterAttachment } from "@/fetchers/correspondence/letters";
import { useConfigList } from "@/hooks/queries/correspondence/use-config";
import { useLetterMutations } from "@/hooks/queries/correspondence/use-letters";
import { toast } from "@/lib/toast";

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
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

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
    setFile(null);
  };

  const submit = () => {
    if (!subject.trim()) return;
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
      },
      {
        onSuccess: async (letter) => {
          if (file) {
            setUploading(true);
            try {
              await uploadLetterAttachment(workspaceId, letter.id, file);
            } catch {
              toast.error("Letter saved, but the attachment upload failed");
            } finally {
              setUploading(false);
            }
          }
          reset();
          setOpen(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
            <Label>Received</Label>
            <DateField value={receivedAt} onChange={setReceivedAt} />
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
            <Label>
              {direction === "in" ? "Sender name" : "Recipient name"}
            </Label>
            <Input
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Organisation</Label>
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
            <Label>Attachment (scan / email PDF)</Label>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-muted/40">
              <Paperclip className="h-4 w-4" />
              {file ? file.name : "Choose a file…"}
              <input
                type="file"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          <div className="hidden sm:col-span-2 sm:block" />
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!subject.trim() || m.create.isPending || uploading}
              onClick={submit}
            >
              {(m.create.isPending || uploading) && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              Capture
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
