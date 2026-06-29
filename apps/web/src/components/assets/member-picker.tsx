import { Check } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ColoredAvatar } from "@/components/ui/colored-avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";

type Member = {
  userId: string;
  user?: { name?: string | null; image?: string | null } | null;
};

/** Popover that selects a workspace member (returns their userId). */
export function MemberPicker({
  workspaceId,
  selectedUserId,
  onSelect,
  trigger,
}: {
  workspaceId: string;
  selectedUserId?: string | null;
  onSelect: (userId: string) => void;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { data } = useGetActiveWorkspaceUsers(workspaceId);
  const members = (data?.members ?? []) as Member[];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <div className="max-h-72 overflow-y-auto">
          {members.map((member) => (
            <button
              key={member.userId}
              type="button"
              onClick={() => {
                onSelect(member.userId);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
            >
              <ColoredAvatar
                name={member.user?.name}
                image={member.user?.image}
                seed={member.userId}
                className="h-6 w-6"
                fallbackClassName="text-[10px]"
              />
              <span className="flex-1 truncate text-left">
                {member.user?.name ?? member.userId}
              </span>
              {selectedUserId === member.userId && (
                <Check className="h-4 w-4 shrink-0" />
              )}
            </button>
          ))}
          {members.length === 0 && (
            <p className="px-2 py-2 text-sm text-muted-foreground">
              No members
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
