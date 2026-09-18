import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Loader2, RefreshCw, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listMeetingDocuments,
  type MeetingArchivalDocument,
  type MeetingDocumentKind,
  meetingDocumentDownloadUrl,
  reindexMeetingDocument,
  uploadArchivalMeetingDocument,
} from "@/fetchers/meeting";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { usePdfCompression } from "@/hooks/use-pdf-compression";
import type { CompressionResult } from "@/lib/compress-pdf";
import { compressionLabel } from "@/lib/compression-label";
import { isPdfUpload } from "@/lib/is-pdf-upload";
import { toast } from "@/lib/toast";

/**
 * Keyed by workspace as well as meeting, like every other meeting query in
 * this app (`["meeting", workspaceId, id]`): the workspace is what the
 * request is authorised against, so two workspaces must never share a cache
 * entry even if a meeting id were ever reused.
 */
export const meetingDocumentsKey = (workspaceId: string, meetingId: string) => [
  "meeting-documents",
  workspaceId,
  meetingId,
];

const KIND_OPTIONS: { value: MeetingDocumentKind; label: string }[] = [
  { value: "minutes", label: "Meeting Minutes" },
  { value: "transcript", label: "Transcript" },
  { value: "other", label: "Other" },
];

// `kind` arrives as a plain string: the three archival kinds above, plus
// "original" for rows written before Spec D (and by the reply-attachment
// path, which never appears in this list).
const KIND_LABELS: Record<string, string> = {
  minutes: "Meeting Minutes",
  transcript: "Transcript",
  other: "Other",
  original: "Original",
};

// An index error is a pdf.js / OCR message and can run to hundreds of
// characters. Enough to recognise the failure, not enough to push the Retry
// button off the row.
const ERROR_PREVIEW_CHARS = 160;

function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function truncate(text: string): string {
  return text.length > ERROR_PREVIEW_CHARS
    ? `${text.slice(0, ERROR_PREVIEW_CHARS)}…`
    : text;
}

/**
 * Compression is best-effort, exactly as the letters uploader treats it: a
 * pdf.js failure (corrupt file, no worker) must not block the upload. Handing
 * the fetcher an explicit untouched result uploads the file as chosen and —
 * the part that matters — stops it re-running the compression that just
 * failed. `cancelled` is the honest skip reason: the run did not finish.
 */
function untouched(file: File): CompressionResult {
  return {
    file,
    originalSize: file.size,
    finalSize: file.size,
    skipped: "cancelled",
  };
}

/**
 * The archival shelf of one meeting: what has been uploaded, where each file
 * is in the indexing pipeline, and the uploader itself.
 *
 * `indexStatus` is on screen rather than hidden because a `pending` document
 * is invisible to search — the spec is explicit that a user who cannot see
 * "Indexing…" concludes search is broken instead of waiting.
 */
export function MeetingDocuments({
  meetingId,
  workspaceId,
  canUpload,
}: {
  meetingId: string;
  workspaceId: string;
  canUpload: boolean;
}) {
  const qc = useQueryClient();
  const queryKey = meetingDocumentsKey(workspaceId, meetingId);
  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => listMeetingDocuments(workspaceId, meetingId),
  });

  const { data: usersData } = useGetActiveWorkspaceUsers(workspaceId);
  const users = usersData?.members ?? [];
  const userName = (id: string | null) =>
    id ? (users.find((u) => u.userId === id)?.user?.name ?? id) : "—";

  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<MeetingDocumentKind>("minutes");
  const compression = usePdfCompression();

  const clearFile = () => {
    setFile(null);
    compression.reset();
    if (inputRef.current) inputRef.current.value = "";
  };

  const upload = useMutation({
    mutationFn: async (picked: File) => {
      // Driven here rather than inside the fetcher so the per-page progress
      // below has something to render; the result is handed on so the file
      // is never compressed twice.
      let result: CompressionResult;
      try {
        result = await compression.run(picked);
      } catch {
        result = untouched(picked);
      }
      return uploadArchivalMeetingDocument(
        workspaceId,
        meetingId,
        picked,
        kind,
        {
          compression: result,
        },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast.success("Document uploaded — indexing has been queued");
      // Only now. Clearing the selection before the upload was attempted
      // would discard the file on failure with no way to retry it.
      clearFile();
    },
    onError: (error) => {
      const reason =
        error instanceof Error && error.message ? error.message : "";
      toast.error(
        `Upload failed${reason ? `: ${reason}` : ""}. The file is still selected — press Upload to retry.`,
      );
    },
  });

  const retry = useMutation({
    mutationFn: (docId: string) =>
      reindexMeetingDocument(workspaceId, meetingId, docId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast.success("Queued for indexing again");
    },
    onError: (error) => {
      const reason =
        error instanceof Error && error.message ? error.message : "";
      toast.error(
        `Couldn't queue that document again${reason ? `: ${reason}` : ""}`,
      );
    },
  });

  const documents = data ?? [];

  return (
    <div className="space-y-2">
      <h3 className="font-medium text-sm">Archival documents</h3>
      <p className="text-muted-foreground text-xs">
        PDFs kept with this meeting. Their text is indexed, so a document is
        only findable in search once it says indexed.
      </p>

      {isLoading ? (
        <div
          className="flex items-center gap-2 py-2 text-muted-foreground text-xs"
          role="status"
          aria-label="Loading documents"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading documents…
        </div>
      ) : isError ? (
        // Deliberately distinct from the empty state below: this module
        // shipped a bug where a failed list rendered exactly like an empty
        // one, and every user who hit it concluded the feature was broken.
        <p className="text-destructive text-xs" role="alert">
          Couldn't load this meeting's documents. Try reopening this meeting.
        </p>
      ) : documents.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No documents uploaded yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {documents.map((doc) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              uploader={userName(doc.createdBy)}
              downloadHref={meetingDocumentDownloadUrl(
                workspaceId,
                meetingId,
                doc.id,
              )}
              canRetry={canUpload}
              retrying={retry.isPending && retry.variables === doc.id}
              onRetry={() => retry.mutate(doc.id)}
            />
          ))}
        </ul>
      )}

      {canUpload && (
        <div className="space-y-1.5 rounded-md border border-border border-dashed p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={kind}
              onValueChange={(value) => {
                // Base UI emits null when a selection is cleared; there is no
                // "no kind" here, so keep whatever was chosen.
                if (value) setKind(value as MeetingDocumentKind);
              }}
            >
              <SelectTrigger className="w-44" aria-label="Document type">
                <SelectValue>
                  {KIND_OPTIONS.find((option) => option.value === kind)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              aria-label="Choose a PDF to archive"
              className="text-xs"
              disabled={upload.isPending}
              onChange={(e) => {
                const picked = e.target.files?.[0] ?? null;
                // Before the network, not after: the input's `accept` is only
                // a hint and drag-and-drop bypasses it.
                if (picked && !isPdfUpload(picked)) {
                  toast.error("Only PDF files can be archived with a meeting");
                  e.target.value = "";
                  setFile(null);
                  return;
                }
                setFile(picked);
                compression.reset();
              }}
            />
            <Button
              size="sm"
              disabled={!file || upload.isPending}
              onClick={() => file && upload.mutate(file)}
            >
              <Upload className="h-3.5 w-3.5" />
              Upload
            </Button>
          </div>
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
          {upload.isPending && !compression.busy && (
            <div
              className="flex items-center gap-2 text-muted-foreground text-xs"
              role="status"
            >
              <Loader2 className="h-3 w-3 animate-spin" />
              Uploading {file?.name}…
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DocumentRow({
  doc,
  uploader,
  downloadHref,
  canRetry,
  retrying,
  onRetry,
}: {
  doc: MeetingArchivalDocument;
  uploader: string;
  downloadHref: string;
  canRetry: boolean;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <li
      data-testid="meeting-document-row"
      className="rounded-md border border-border px-2.5 py-1.5 text-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Badge variant="outline" className="shrink-0 text-xs">
            {KIND_LABELS[doc.kind] ?? doc.kind}
          </Badge>
          <span className="truncate">{doc.filename}</span>
        </span>
        <span className="flex shrink-0 items-center gap-3 text-muted-foreground text-xs">
          <span>{formatSize(doc.size)}</span>
          <span>{uploader}</span>
          <a
            href={downloadHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Download ${doc.filename}`}
            className="hover:text-foreground"
          >
            <Download className="h-4 w-4" />
          </a>
        </span>
      </div>
      {doc.indexStatus === "pending" && (
        <p className="mt-1 text-muted-foreground text-xs">
          Indexing… this document is not searchable yet.
        </p>
      )}
      {doc.indexStatus === "failed" && (
        <div className="mt-1 flex items-start justify-between gap-2">
          <p className="text-destructive text-xs" role="alert">
            Indexing failed
            {doc.indexError ? `: ${truncate(doc.indexError)}` : ""}
          </p>
          {canRetry && (
            <Button
              variant="outline"
              size="xs"
              disabled={retrying}
              onClick={onRetry}
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
