import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  LayoutGrid,
  List,
  Loader2,
  Lock,
  Search,
  Upload,
  UserCog,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listCommittees } from "@/fetchers/committees";
import { configResource } from "@/fetchers/correspondence";
import type { MatchedDocument, MeetingListItem } from "@/fetchers/meeting";
import { usePastMinutes } from "@/hooks/queries/meeting/use-past-minutes";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatDateMedium } from "@/lib/format";
import { HighlightedText } from "./highlighted-text";
import { MeetingCard } from "./meeting-card";
import {
  ArchivistsDialog,
  PastMinuteDetailDialog,
  PastMinuteFormDialog,
} from "./past-minute-dialogs";

type ViewMode = "grid" | "list";

const VIEW_KEY = "kaneo:past-minutes:view";
const ALL = "all";

// Remembering the view is a per-viewer convenience: storage can be missing
// or blocked, and the page must work the same without it.
function readView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

function saveView(view: ViewMode) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Nothing to do: the choice just won't be remembered.
  }
}

/**
 * Past Minutes: meetings held before this system, kept as their original
 * documents (PDF, Word, PowerPoint) with enough details recorded to find
 * them. Separate from the live Meeting Minutes library on purpose: these
 * never go through drafting or adoption, and mixing them in would bury the
 * meetings that still need work.
 *
 * Search reads the documents' text as well as the details, and each hit
 * shows the matching passages with the term highlighted.
 */
export function PastMinutes({ workspaceId }: { workspaceId: string }) {
  const { isAdmin } = useWorkspacePermission();
  const [view, setView] = useState<ViewMode>(readView);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [bodyId, setBodyId] = useState(ALL);
  const [meetingTypeId, setMeetingTypeId] = useState(ALL);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [managingArchivists, setManagingArchivists] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const filters = useMemo(
    () => ({
      q: debounced || undefined,
      bodyId: bodyId === ALL ? undefined : bodyId,
      meetingTypeId: meetingTypeId === ALL ? undefined : meetingTypeId,
      from: from || undefined,
      to: to || undefined,
    }),
    [debounced, bodyId, meetingTypeId, from, to],
  );
  const filtering =
    bodyId !== ALL || meetingTypeId !== ALL || Boolean(from) || Boolean(to);

  const {
    data,
    isLoading,
    isError,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = usePastMinutes(workspaceId, filters);

  const { data: committees = [] } = useQuery({
    queryKey: ["committees", workspaceId, "active"],
    queryFn: () => listCommittees(workspaceId, false),
    enabled: !!workspaceId,
  });
  const { data: types = [] } = useQuery({
    queryKey: ["gm-config", workspaceId, "meeting-types"],
    queryFn: () => configResource("meeting-types").list(workspaceId),
    enabled: !!workspaceId,
  });

  const items = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data],
  );
  const canManage = data?.pages[0]?.canManage ?? false;
  const pendingIndexCount = data?.pages[0]?.pendingIndexCount ?? 0;

  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage || isFetchingNextPage) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) fetchNextPage();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const clearAll = () => {
    setSearch("");
    setDebounced("");
    setBodyId(ALL);
    setMeetingTypeId(ALL);
    setFrom("");
    setTo("");
  };

  const changeView = (next: ViewMode) => {
    setView(next);
    saveView(next);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-lg">Past Minutes</h2>
          <p className="text-muted-foreground text-sm">
            Minutes of meetings held before this system, kept as their original
            documents and searchable by what they say.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setManagingArchivists(true)}
            >
              <UserCog className="h-3.5 w-3.5" />
              Archivists
            </Button>
          )}
          {canManage && (
            <Button size="sm" onClick={() => setUploading(true)}>
              <Upload className="h-3.5 w-3.5" />
              Upload past minutes
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="relative">
          <Search className="-translate-y-1/2 absolute top-1/2 left-3 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search the text of past minutes, titles, references and chairpersons"
            aria-label="Search Past Minutes"
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <FilterSelect
            label="Committee"
            value={bodyId}
            onChange={setBodyId}
            options={committees.map((b) => ({ value: b.id, label: b.name }))}
          />
          <FilterSelect
            label="Meeting type"
            value={meetingTypeId}
            onChange={setMeetingTypeId}
            options={types.map((t) => ({
              value: t.id,
              label: String(t.label ?? t.id),
            }))}
          />
          <div className="space-y-1">
            <Label className="block text-xs" htmlFor="past-minutes-from">
              From
            </Label>
            <Input
              id="past-minutes-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="space-y-1">
            <Label className="block text-xs" htmlFor="past-minutes-to">
              To
            </Label>
            <Input
              id="past-minutes-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className="w-40"
            />
          </div>
          {filtering && (
            <Button variant="ghost" size="sm" onClick={clearAll}>
              <X className="h-3.5 w-3.5" />
              Clear filters
            </Button>
          )}
          <fieldset className="ml-auto flex gap-1 border-0 p-0">
            <legend className="sr-only">View as</legend>
            <Button
              variant={view === "grid" ? "secondary" : "ghost"}
              size="icon-sm"
              aria-label="Thumbnail view"
              aria-pressed={view === "grid"}
              onClick={() => changeView("grid")}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={view === "list" ? "secondary" : "ghost"}
              size="icon-sm"
              aria-label="List view"
              aria-pressed={view === "list"}
              onClick={() => changeView("list")}
            >
              <List className="h-4 w-4" />
            </Button>
          </fieldset>
        </div>
      </div>

      {pendingIndexCount > 0 && (
        <p className="text-muted-foreground text-xs">
          {pendingIndexCount === 1
            ? "1 document is"
            : `${pendingIndexCount} documents are`}{" "}
          still being indexed, so search results may be incomplete.
        </p>
      )}

      {isLoading ? (
        <div
          className="flex items-center gap-2 py-12 text-muted-foreground text-sm"
          role="status"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading Past Minutes…
        </div>
      ) : isError ? (
        <div
          className="mx-auto max-w-md space-y-3 py-12 text-center"
          role="alert"
        >
          <h3 className="font-medium text-sm">Couldn't load Past Minutes</h3>
          <p className="text-muted-foreground text-sm">
            Something went wrong fetching this workspace's past minutes.
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      ) : items.length === 0 ? (
        debounced || filtering ? (
          <div className="mx-auto max-w-md space-y-3 py-12 text-center">
            <h3 className="font-medium text-sm">No past minutes matched</h3>
            <p className="text-muted-foreground text-sm">
              {debounced
                ? `Nothing matches “${debounced}” with these filters.`
                : "Nothing matches these filters."}
            </p>
            <Button variant="outline" size="sm" onClick={clearAll}>
              <X className="h-3.5 w-3.5" />
              Clear search and filters
            </Button>
          </div>
        ) : (
          <div className="mx-auto max-w-md space-y-2 py-12 text-center">
            <h3 className="font-medium text-sm">No past minutes yet</h3>
            <p className="text-muted-foreground text-sm">
              {canManage
                ? "Upload the minutes of an earlier meeting to start the archive."
                : "Minutes archivists can upload the minutes of earlier meetings here."}
            </p>
          </div>
        )
      ) : (
        <>
          {view === "grid" ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {items.map((meeting) => (
                <div key={meeting.id} className="flex flex-col gap-1">
                  <MeetingCard
                    meeting={meeting}
                    onOpen={() => setOpenId(meeting.id)}
                  />
                  <SearchHits
                    documents={meeting.matchedDocuments}
                    term={debounced}
                    compact
                  />
                </div>
              ))}
            </div>
          ) : (
            <PastMinutesTable
              items={items}
              term={debounced}
              onOpen={setOpenId}
            />
          )}
          <div ref={sentinel} />
          {hasNextPage && (
            <div className="flex justify-center py-2">
              {isFetchingNextPage ? (
                <span
                  role="status"
                  className="flex items-center gap-2 text-muted-foreground text-sm"
                >
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading more…
                </span>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchNextPage()}
                >
                  Load more
                </Button>
              )}
            </div>
          )}
        </>
      )}

      <PastMinuteFormDialog
        workspaceId={workspaceId}
        open={uploading}
        onClose={() => setUploading(false)}
        onSaved={(id) => setOpenId(id)}
        committees={committees}
        meetingTypes={types}
      />
      <PastMinuteDetailDialog
        workspaceId={workspaceId}
        meetingId={openId}
        canManage={canManage}
        onClose={() => setOpenId(null)}
        committees={committees}
        meetingTypes={types}
      />
      {isAdmin && (
        <ArchivistsDialog
          workspaceId={workspaceId}
          open={managingArchivists}
          onClose={() => setManagingArchivists(false)}
        />
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  const selected = options.find((o) => o.value === value)?.label;
  return (
    <div className="space-y-1">
      <Label className="block text-xs">{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v ?? ALL)}>
        <SelectTrigger className="w-48" aria-label={label}>
          <SelectValue>{selected ?? "All"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function PastMinutesTable({
  items,
  term,
  onOpen,
}: {
  items: MeetingListItem[];
  term: string;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-32">Meeting date</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Committee</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="w-24 text-right">Documents</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((m) => (
            <TableRow
              key={m.id}
              className="cursor-pointer align-top"
              onClick={() => onOpen(m.id)}
            >
              <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                {m.scheduledAt ? formatDateMedium(m.scheduledAt) : "-"}
              </TableCell>
              <TableCell className="min-w-64 whitespace-normal">
                <button
                  type="button"
                  className="text-left font-medium text-sm hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(m.id);
                  }}
                >
                  {m.title}
                </button>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
                  {m.referenceNo && <span>{m.referenceNo}</span>}
                  {m.chairperson && <span>Chaired by {m.chairperson}</span>}
                  {m.confidential && (
                    <Badge variant="destructive" className="gap-1 text-xs">
                      <Lock className="h-3 w-3" />
                      Confidential
                    </Badge>
                  )}
                </div>
                <SearchHits documents={m.matchedDocuments} term={term} />
              </TableCell>
              <TableCell className="text-sm">{m.bodyName ?? "-"}</TableCell>
              <TableCell className="text-sm">
                {m.meetingTypeLabel ?? "-"}
              </TableCell>
              <TableCell className="text-right text-muted-foreground text-xs">
                {m.documentCount}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// The server returns every matching document with up to three passages
// each; how many to show is a presentation choice.
const MAX_DOCUMENTS = 3;

/**
 * Where the search term appears inside the documents: the file, then each
 * matching passage with the term highlighted. Nothing renders when the hit
 * came from the recorded details rather than document text.
 */
function SearchHits({
  documents,
  term,
  compact = false,
}: {
  documents: MatchedDocument[];
  term: string;
  compact?: boolean;
}) {
  if (documents.length === 0 || !term) return null;
  const shown = documents.slice(0, MAX_DOCUMENTS);
  const remaining = documents.length - shown.length;
  return (
    <div className="mt-1.5 space-y-1.5 text-xs">
      {shown.map((doc) => {
        const passages = doc.snippets?.length ? doc.snippets : [doc.snippet];
        return (
          <div key={doc.id} className="space-y-0.5">
            <p className="flex items-center gap-1 font-medium text-muted-foreground">
              <FileText className="h-3 w-3 shrink-0" />
              <span className="truncate">{doc.filename}</span>
            </p>
            {(compact ? passages.slice(0, 1) : passages).map((passage) => (
              <p
                key={passage}
                className={
                  compact
                    ? "line-clamp-3 text-muted-foreground"
                    : "border-border border-l-2 pl-2 text-muted-foreground"
                }
              >
                <HighlightedText text={passage} term={term} />
              </p>
            ))}
          </div>
        );
      })}
      {remaining > 0 && (
        <p className="text-muted-foreground">
          +{remaining} more {remaining === 1 ? "document" : "documents"}
        </p>
      )}
    </div>
  );
}
