import { Mail } from "lucide-react";
import { useState } from "react";
import { LetterDetailDialog } from "@/components/general-management/letter-detail-dialog";
import { useMyCorrespondence } from "@/hooks/queries/correspondence/use-letters";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { formatDateMedium } from "@/lib/format";

/** The current user's correspondence — letters they lead + actions minuted to them. */
export default function MyCorrespondence() {
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const { data } = useMyCorrespondence(workspaceId);
  const [openId, setOpenId] = useState<string | null>(null);

  const letters = data?.letters ?? [];
  const actions = data?.actions ?? [];
  const total = letters.length + actions.length;
  if (total === 0) return null;

  return (
    <div className="mb-6 rounded-lg border border-border">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 font-medium text-muted-foreground text-xs">
        <Mail className="h-3.5 w-3.5" /> Correspondence ({total})
      </div>

      {letters.length > 0 && (
        <div>
          <div className="px-4 pt-2.5 pb-1 font-medium text-[11px] text-muted-foreground/80 uppercase tracking-wide">
            To inspect
          </div>
          <ul className="divide-y divide-border">
            {letters.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(l.id)}
                  className="block w-full px-4 py-2.5 text-left text-sm hover:bg-accent/60"
                >
                  <div className="truncate font-medium">{l.subject}</div>
                  <div className="text-muted-foreground text-xs">
                    {l.refNo ?? "unregistered"} ·{" "}
                    {l.direction === "in" ? "Masuk" : "Keluar"} · {l.status}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {actions.length > 0 && (
        <div>
          <div className="px-4 pt-2.5 pb-1 font-medium text-[11px] text-muted-foreground/80 uppercase tracking-wide">
            Actions assigned to me
          </div>
          <ul className="divide-y divide-border">
            {actions.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(a.letterId)}
                  className="block w-full px-4 py-2.5 text-left text-sm hover:bg-accent/60"
                >
                  <div className="truncate font-medium">{a.body}</div>
                  <div className="text-muted-foreground text-xs">
                    {a.refNo ?? "unregistered"} · {a.subject}
                    {a.dueAt ? ` · due ${formatDateMedium(a.dueAt)}` : ""}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {workspaceId && (
        <LetterDetailDialog
          workspaceId={workspaceId}
          letterId={openId}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
