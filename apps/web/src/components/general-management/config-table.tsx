import { Pencil, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { ConfigItem } from "@/fetchers/correspondence";
import { useConfigMutations } from "@/hooks/queries/correspondence/use-config";

type FieldType = "text" | "number" | "email" | "textarea" | "switch" | "select";

export type ConfigField = {
  key: string;
  label: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  help?: string;
  defaultValue?: string | number | boolean;
  /** Full-width form row (default true for textarea). */
  wide?: boolean;
};

export type ConfigColumn = {
  key: string;
  label: string;
  render?: (item: ConfigItem) => ReactNode;
};

type FormValue = string | number | boolean;
type FormState = Record<string, FormValue>;

function initialForm(fields: ConfigField[], item?: ConfigItem): FormState {
  const state: FormState = {};
  for (const f of fields) {
    const existing = item?.[f.key];
    if (existing !== undefined && existing !== null) {
      state[f.key] = existing as FormValue;
    } else if (f.defaultValue !== undefined) {
      state[f.key] = f.defaultValue;
    } else {
      state[f.key] = f.type === "switch" ? false : "";
    }
  }
  return state;
}

export function ConfigTable({
  workspaceId,
  resource,
  title,
  description,
  fields,
  columns,
  items,
  addLabel = "Add",
  toForm,
  toBody,
}: {
  workspaceId: string;
  resource: string;
  title: string;
  description?: string;
  fields: ConfigField[];
  columns: ConfigColumn[];
  items: ConfigItem[];
  addLabel?: string;
  /** Map a stored item into the form (e.g. flatten nested config). */
  toForm?: (item: ConfigItem) => FormState;
  /** Map form values into the request body (e.g. nest fields). */
  toBody?: (form: FormState) => Record<string, unknown>;
}) {
  const rows = items;
  const confirm = useConfirm();
  const m = useConfigMutations(resource, workspaceId);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ConfigItem | null>(null);
  const [form, setForm] = useState<FormState>(() => initialForm(fields));

  const startAdd = () => {
    setEditing(null);
    setForm(initialForm(fields));
    setOpen(true);
  };
  const startEdit = (item: ConfigItem) => {
    setEditing(item);
    setForm(toForm ? toForm(item) : initialForm(fields, item));
    setOpen(true);
  };

  const set = (key: string, value: FormValue) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const missingRequired = fields.some(
    (f) =>
      f.required &&
      (form[f.key] === undefined || form[f.key] === "" || form[f.key] === null),
  );

  const submit = () => {
    // Omit blank optional fields so they persist as null (never "") — an empty
    // FK/text value would otherwise error or pollute the record.
    const body = toBody
      ? toBody(form)
      : Object.fromEntries(
          Object.entries(form).filter(([, value]) => value !== ""),
        );
    const onSuccess = () => setOpen(false);
    if (editing) {
      m.update.mutate({ id: editing.id, body }, { onSuccess });
    } else {
      m.create.mutate(body, { onSuccess });
    }
  };

  const remove = async (item: ConfigItem) => {
    if (
      await confirm({
        title: `Remove "${(item.name as string) ?? (item.label as string) ?? "item"}"?`,
        description:
          "It will be deactivated (retired), not permanently deleted.",
        confirmText: "Remove",
      })
    ) {
      m.deactivate.mutate(item.id);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-base">{title}</h3>
          {description && (
            <p className="text-muted-foreground text-sm">{description}</p>
          )}
        </div>
        <Button size="sm" onClick={startAdd}>
          <Plus className="h-3.5 w-3.5" /> {addLabel}
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col.key}>{col.label}</TableHead>
              ))}
              <TableHead className="w-20 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((item) => (
              <TableRow key={item.id}>
                {columns.map((col) => (
                  <TableCell key={col.key}>
                    {col.render
                      ? col.render(item)
                      : ((item[col.key] as ReactNode) ?? "—")}
                  </TableCell>
                ))}
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => startEdit(item)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(item)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 && (
          <div className="py-10 text-center text-muted-foreground text-sm">
            Nothing configured yet.
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${title}` : `Add ${title}`}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 px-6 pb-4 sm:grid-cols-2">
            {fields.map((f) => {
              const wide = f.wide ?? f.type === "textarea";
              return (
                <div
                  key={f.key}
                  className={`space-y-1.5 ${wide ? "sm:col-span-2" : ""}`}
                >
                  {f.type !== "switch" && (
                    <Label>
                      {f.label}
                      {f.required && (
                        <span className="text-destructive"> *</span>
                      )}
                    </Label>
                  )}
                  {f.type === "select" ? (
                    <Select
                      value={String(form[f.key] ?? "")}
                      onValueChange={(v) => set(f.key, v)}
                    >
                      <SelectTrigger>
                        <SelectValue>
                          {f.options?.find(
                            (o) => o.value === String(form[f.key] ?? ""),
                          )?.label ?? "Select…"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {f.options?.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : f.type === "switch" ? (
                    <div className="flex items-center gap-2 pt-1">
                      <Switch
                        checked={Boolean(form[f.key])}
                        onCheckedChange={(v) => set(f.key, v)}
                      />
                      <Label>{f.label}</Label>
                    </div>
                  ) : f.type === "textarea" ? (
                    <Textarea
                      value={String(form[f.key] ?? "")}
                      placeholder={f.placeholder}
                      onChange={(e) => set(f.key, e.target.value)}
                    />
                  ) : (
                    <Input
                      type={f.type === "number" ? "number" : f.type}
                      value={String(form[f.key] ?? "")}
                      placeholder={f.placeholder}
                      onChange={(e) =>
                        set(
                          f.key,
                          f.type === "number"
                            ? e.target.value === ""
                              ? ""
                              : Number(e.target.value)
                            : e.target.value,
                        )
                      }
                    />
                  )}
                  {f.help && (
                    <p className="text-muted-foreground text-xs">{f.help}</p>
                  )}
                </div>
              );
            })}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={
                  missingRequired || m.create.isPending || m.update.isPending
                }
                onClick={submit}
              >
                {editing ? "Save changes" : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
