import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
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
  buildLocationPaths,
  useLocationMutations,
  useLocations,
} from "@/hooks/queries/asset-registry/use-locations";

const TYPES = ["site", "building", "floor", "room"];

export function LocationsManager({ workspaceId }: { workspaceId: string }) {
  const { data: locations = [], isLoading } = useLocations(workspaceId);
  const { create, remove } = useLocationMutations(workspaceId);
  const paths = buildLocationPaths(locations);

  const [name, setName] = useState("");
  const [type, setType] = useState("room");
  const [parentId, setParentId] = useState<string | null>(null);

  const sorted = [...locations].sort((a, b) =>
    (paths.get(a.id) ?? "").localeCompare(paths.get(b.id) ?? ""),
  );

  const add = () => {
    if (!name.trim()) return;
    create.mutate(
      { name: name.trim(), type, parentId },
      { onSuccess: () => setName("") },
    );
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Locations</h2>
        <p className="text-sm text-muted-foreground">
          Organise sites, buildings, floors and rooms. Assets can be placed in
          any of these.
        </p>
      </div>

      <div className="space-y-1.5">
        {sorted.map((l) => (
          <div
            key={l.id}
            className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
          >
            <div>
              <span>{paths.get(l.id)}</span>
              <span className="ml-2 text-xs capitalize text-muted-foreground">
                {l.type}
              </span>
            </div>
            <button
              type="button"
              onClick={() => remove.mutate(l.id)}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {locations.length === 0 && !isLoading && (
          <p className="text-sm text-muted-foreground">No locations yet.</p>
        )}
      </div>

      <div className="grid gap-2 rounded-lg border border-dashed border-border p-3 sm:grid-cols-2">
        <Input
          placeholder="Name *"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Select value={type} onValueChange={setType}>
          <SelectTrigger>
            <SelectValue>{type}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={parentId ?? "none"}
          onValueChange={(v) => setParentId(v === "none" ? null : v)}
        >
          <SelectTrigger>
            <SelectValue>
              {parentId ? (paths.get(parentId) ?? "Parent") : "No parent"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No parent</SelectItem>
            {sorted.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {paths.get(l.id)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={!name.trim() || create.isPending}
          onClick={add}
        >
          <Plus className="h-3.5 w-3.5" /> Add location
        </Button>
      </div>
    </div>
  );
}
