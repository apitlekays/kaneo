import { XIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Letter } from "@/fetchers/correspondence/letters";
import { useLetters } from "@/hooks/queries/correspondence/use-letters";
import { letterReference } from "@/lib/letter-reference";

export type LinkRelation = "reply" | "related" | "supersedes";

export type PendingLink = {
  toLetterId: string;
  relation: LinkRelation;
  label: string;
};

const RELATIONS: { value: LinkRelation; label: string }[] = [
  { value: "reply", label: "Reply to" },
  { value: "related", label: "Related to" },
  { value: "supersedes", label: "Supersedes" },
];

// Names a candidate the same way the register does, so a linked letter is
// recognisable wherever it turns up.
function candidateLabel(letter: Letter): string {
  return `${letterReference(letter)} — ${letter.subject}`;
}

// A link the picker should treat as already present without owning it —
// e.g. a link the letter already has, saved to the server before this
// picker instance ever mounted. Identified the same way a pending link is:
// by the (letter, relation) pair, not the letter alone.
export type ExistingLink = {
  toLetterId: string;
  relation: LinkRelation;
};

/**
 * Controlled picker for linking one letter to another. Holds no server
 * state — the caller owns `value`/`onChange` because two very different
 * callers use it: the registration dialog, where the letter being linked
 * FROM has no id yet, and the detail view, where it does (passed as
 * `excludeId` so the letter can't be linked to itself).
 */
export function LetterLinkPicker({
  workspaceId,
  value,
  onChange,
  excludeId,
  alreadyLinked = [],
}: {
  workspaceId: string;
  value: PendingLink[];
  onChange: (next: PendingLink[]) => void;
  excludeId?: string;
  // Links the letter already has (from the server), so re-offering a
  // counterpart under a relation it's already linked under doesn't produce
  // a second, identical link. Reuses the same (toLetterId, relation)
  // matching as the pending-link dedup below rather than a second
  // mechanism.
  alreadyLinked?: ExistingLink[];
}) {
  // The letters list endpoint returns every letter in the workspace
  // unpaginated, so filtering candidates client-side is correct here.
  const { data: letters = [] } = useLetters(workspaceId, {});
  const [term, setTerm] = useState("");
  const [relation, setRelation] = useState<LinkRelation>("related");

  // The backend allows the same pair of letters to be linked twice under
  // different relations (no unique constraint on fromLetterId/toLetterId),
  // so only the identical (letter, relation) pair already linked — whether
  // still pending (`value`) or already saved (`alreadyLinked`) — is a
  // genuinely useless offer, not the letter under every relation. This
  // must recompute whenever `relation` changes.
  const linkedUnderSelectedRelation = new Set(
    [...value, ...alreadyLinked]
      .filter((link) => link.relation === relation)
      .map((link) => link.toLetterId),
  );
  const q = term.trim().toLowerCase();
  const candidates = letters.filter((letter) => {
    if (excludeId && letter.id === excludeId) return false;
    if (linkedUnderSelectedRelation.has(letter.id)) return false;
    if (!q) return true;
    return (
      letter.subject.toLowerCase().includes(q) ||
      (letter.refNo ?? "").toLowerCase().includes(q) ||
      (letter.externalRefNo ?? "").toLowerCase().includes(q)
    );
  });

  const addLink = (letter: Letter) => {
    onChange([
      ...value,
      { toLetterId: letter.id, relation, label: candidateLabel(letter) },
    ]);
    setTerm("");
  };

  // The same letter can be added twice under different relations (see the
  // dedup guard above), so a link is only uniquely identified by the pair —
  // not by `toLetterId` alone. Using just the id here would give two badges
  // the same React key and the same accessible name, and removing either
  // one would remove both.
  const linkKey = (link: PendingLink) => `${link.toLetterId}:${link.relation}`;

  const removeLink = (key: string) => {
    onChange(value.filter((link) => linkKey(link) !== key));
  };

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((link) => (
            <Badge key={linkKey(link)} className="gap-1 pe-1" variant="outline">
              <span className="text-muted-foreground">{link.relation}:</span>
              {link.label}
              <button
                aria-label={`Remove ${link.relation} link to ${link.label}`}
                className="ms-0.5 flex items-center rounded-sm p-0.5 hover:bg-accent"
                onClick={() => removeLink(linkKey(link))}
                type="button"
              >
                <XIcon className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Select
          onValueChange={(v) => setRelation(v as LinkRelation)}
          value={relation}
        >
          <SelectTrigger className="w-40 shrink-0">
            <SelectValue>
              {RELATIONS.find((r) => r.value === relation)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {RELATIONS.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex-1 space-y-1">
          <Label className="sr-only">Search letters to link</Label>
          <Input
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search letters by subject or reference…"
            value={term}
          />
        </div>
      </div>

      <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-border p-1">
        {candidates.length === 0 && (
          <p className="px-2 py-1.5 text-muted-foreground text-sm">
            No matching letters.
          </p>
        )}
        {candidates.map((letter) => (
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
            key={letter.id}
            onClick={() => addLink(letter)}
            type="button"
          >
            <span className="font-medium">{letterReference(letter)}</span>
            <span className="flex-1 truncate text-muted-foreground">
              {letter.subject}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
