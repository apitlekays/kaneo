import { Loader2, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLetters } from "@/hooks/queries/correspondence/use-letters";
import { cn } from "@/lib/cn";
import { formatDateMedium } from "@/lib/format";
import { LetterCaptureDialog } from "./letter-capture-dialog";
import { LetterDetailDialog } from "./letter-detail-dialog";

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "captured", label: "Captured" },
  { value: "registered", label: "Registered" },
  { value: "classified", label: "Classified" },
  { value: "assigned", label: "Assigned" },
  { value: "in-action", label: "In action" },
  { value: "awaiting-response", label: "Awaiting response" },
  { value: "closed", label: "Closed" },
];

export function Correspondence({ workspaceId }: { workspaceId: string }) {
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: letters = [], isLoading } = useLetters(workspaceId, {
    direction,
    status: status === "all" ? undefined : status,
    q: q.trim() || undefined,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-lg">Correspondence</h2>
          <p className="text-muted-foreground text-sm">
            Surat Masuk &amp; Surat Keluar registry.
          </p>
        </div>
        <LetterCaptureDialog
          workspaceId={workspaceId}
          defaultDirection={direction}
          trigger={
            <Button size="sm">
              <Plus className="h-3.5 w-3.5" /> Register
            </Button>
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border p-0.5 text-sm">
          <button
            type="button"
            onClick={() => setDirection("in")}
            className={cn(
              "rounded-md px-3 py-1",
              direction === "in" && "bg-muted font-medium",
            )}
          >
            Letter In
          </button>
          <button
            type="button"
            onClick={() => setDirection("out")}
            className={cn(
              "rounded-md px-3 py-1",
              direction === "out" && "bg-muted font-medium",
            )}
          >
            Letter Out
          </button>
        </div>
        <div className="relative">
          <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search subject, ref, sender…"
            className="w-64 pl-8"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44">
            <SelectValue>
              {STATUS_OPTIONS.find((s) => s.value === status)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ref No.</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>{direction === "in" ? "From" : "To"}</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {letters.map((letter) => (
              <TableRow
                key={letter.id}
                onClick={() => setSelectedId(letter.id)}
                className="cursor-pointer"
              >
                <TableCell className="font-mono text-xs">
                  {letter.refNo ?? "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDateMedium(
                    letter.receivedAt ?? letter.letterDate ?? letter.createdAt,
                  )}
                </TableCell>
                <TableCell className="font-medium">{letter.subject}</TableCell>
                <TableCell className="text-muted-foreground">
                  {(direction === "in"
                    ? (letter.senderName ?? letter.senderOrg)
                    : (letter.recipientName ?? letter.recipientOrg)) ?? "—"}
                </TableCell>
                <TableCell>
                  <Badge className="border text-xs">{letter.status}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          letters.length === 0 && (
            <div className="py-10 text-center text-muted-foreground text-sm">
              No {direction === "in" ? "incoming" : "outgoing"} letters yet.
            </div>
          )
        )}
      </div>

      <LetterDetailDialog
        workspaceId={workspaceId}
        letterId={selectedId}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
