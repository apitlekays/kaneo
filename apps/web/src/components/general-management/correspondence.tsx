import type { VariantProps } from "class-variance-authority";
import { Archive, Clock, Loader2, Plus, Search } from "lucide-react";
import { Fragment, useState } from "react";
import { Badge, type badgeVariants } from "@/components/ui/badge";
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
import { useConfigList } from "@/hooks/queries/correspondence/use-config";
import {
  useAwaitingAcceptance,
  useLetters,
} from "@/hooks/queries/correspondence/use-letters";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { cn } from "@/lib/cn";
import { formatDateMedium, formatRelativeTime } from "@/lib/format";
import {
  groupLettersByYear,
  letterYearDate,
  nextSortDirection,
} from "@/lib/letter-grouping";
import { letterReference, referenceHeader } from "@/lib/letter-reference";
import { urgencyBadge } from "@/lib/urgency";
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
  const [showDisposed, setShowDisposed] = useState(false);
  const [showAwaiting, setShowAwaiting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const { data: letters = [], isLoading } = useLetters(workspaceId, {
    direction,
    status: showDisposed || status === "all" ? undefined : status,
    q: q.trim() || undefined,
    disposed: showDisposed || undefined,
  });
  const { data: awaiting = [], isLoading: isAwaitingLoading } =
    useAwaitingAcceptance(workspaceId);
  const { data: usersData } = useGetActiveWorkspaceUsers(workspaceId);
  // includeInactive: a retired organisation must keep showing its label on
  // historical letters, even though it's no longer offered for new ones (the
  // capture dialog's own useConfigList call stays active-only for that).
  const { data: organisations = [] } = useConfigList(
    "organisations",
    workspaceId,
    true,
  );
  const users = usersData?.members ?? [];
  const userName = (id: string | null) =>
    id ? (users.find((u) => u.userId === id)?.user?.name ?? id) : "—";
  const organisationName = new Map(
    organisations.map((org) => [org.id, org.label as string]),
  );
  const groups = groupLettersByYear(letters, letterYearDate, sortDirection);

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
        {!showDisposed && !showAwaiting && (
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
        )}
        <Button
          size="sm"
          variant={showAwaiting ? "default" : "outline"}
          onClick={() =>
            setShowAwaiting((v) => {
              const next = !v;
              if (next) setShowDisposed(false);
              return next;
            })
          }
          className="ml-auto"
        >
          <Clock className="h-3.5 w-3.5" />
          {showAwaiting ? "Back to register" : "Needs attention"}
        </Button>
        <Button
          size="sm"
          variant={showDisposed ? "default" : "outline"}
          onClick={() =>
            setShowDisposed((v) => {
              const next = !v;
              if (next) setShowAwaiting(false);
              return next;
            })
          }
        >
          <Archive className="h-3.5 w-3.5" />
          {showDisposed ? "Back to register" : "Disposed"}
        </Button>
      </div>

      {showDisposed && (
        <p className="text-muted-foreground text-sm">
          Disposed records. These keep their reference number and stay in the
          register's history — they are only hidden from the working list.
        </p>
      )}
      {showAwaiting && (
        <p className="text-muted-foreground text-sm">
          Letters waiting on a decision, and letters that were rejected and have
          not been routed on since. Both clear themselves once someone acts.
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-border">
        {showAwaiting ? (
          <Table>
            <TableHeader>
              <TableRow>
                {/* This watchlist mixes incoming and outgoing letters (its
                query has no direction filter), so a direction-specific
                header here would mislabel half the rows. Stay neutral;
                each row's own letterReference(item) is still accurate. */}
                <TableHead>Reference</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>State</TableHead>
                <TableHead>With</TableHead>
                <TableHead>For</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {awaiting.map((item) => (
                <TableRow
                  key={item.id}
                  onClick={() => setSelectedId(item.letterId)}
                  className="cursor-pointer"
                >
                  <TableCell className="font-mono text-xs">
                    {letterReference(item)}
                  </TableCell>
                  <TableCell className="font-medium">{item.subject}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        item.status === "rejected" ? "destructive" : "outline"
                      }
                      className="text-xs"
                    >
                      {item.status === "rejected" ? "Rejected" : "Awaiting"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.status === "rejected"
                      ? item.currentAssigneeId
                        ? `back with ${userName(item.currentAssigneeId)}`
                        : "nobody"
                      : userName(item.toUserId)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelativeTime(item.decidedAt ?? item.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{referenceHeader(direction)}</TableHead>
                <TableHead>
                  <button
                    type="button"
                    onClick={() =>
                      setSortDirection(nextSortDirection(sortDirection))
                    }
                    className="inline-flex items-center gap-1"
                  >
                    Date
                    {sortDirection === "desc" ? "↓" : "↑"}
                  </button>
                </TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>{direction === "in" ? "From" : "To"}</TableHead>
                <TableHead>Urgency</TableHead>
                <TableHead>Organisation</TableHead>
                <TableHead>Actions</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <Fragment key={group.year}>
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="bg-muted/50 font-semibold text-muted-foreground text-xs"
                    >
                      {group.year}
                    </TableCell>
                  </TableRow>
                  {group.letters.map((letter) => (
                    <TableRow
                      key={letter.id}
                      onClick={() => setSelectedId(letter.id)}
                      className="cursor-pointer"
                    >
                      <TableCell className="font-mono text-xs">
                        {letterReference(letter)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateMedium(
                          letter.receivedAt ??
                            letter.letterDate ??
                            letter.createdAt,
                        )}
                      </TableCell>
                      <TableCell className="font-medium">
                        {letter.subject}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {(direction === "in"
                          ? (letter.senderName ?? letter.senderOrg)
                          : (letter.recipientName ?? letter.recipientOrg)) ??
                          "—"}
                      </TableCell>
                      <TableCell>
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
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {letter.organisationId
                          ? (organisationName.get(letter.organisationId) ?? "—")
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {letter.actionsTotal ? (
                          <Badge
                            variant={
                              letter.actionsDone === letter.actionsTotal
                                ? "success"
                                : "outline"
                            }
                            className="text-xs"
                          >
                            {letter.actionsDone}/{letter.actionsTotal} done
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className="border text-xs">
                          {letter.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        )}
        {showAwaiting ? (
          isAwaitingLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            awaiting.length === 0 && (
              <div className="py-10 text-center text-muted-foreground text-sm">
                Nothing needs attention.
              </div>
            )
          )
        ) : isLoading ? (
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
