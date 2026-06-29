import { Link } from "@tanstack/react-router";
import { Wrench } from "lucide-react";
import { useMyWorkOrders } from "@/hooks/queries/asset-registry/use-work-orders";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { authClient } from "@/lib/auth-client";
import { formatDateMedium } from "@/lib/format";

/** The current user's open asset work orders, surfaced on Home. */
export default function MyWorkOrders() {
  const { data: workspace } = useActiveWorkspace();
  const { data: session } = authClient.useSession();
  const { data: workOrders = [] } = useMyWorkOrders(
    workspace?.id ?? "",
    session?.user?.id,
  );

  if (workOrders.length === 0) return null;

  return (
    <div className="mb-6 rounded-lg border border-border">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-xs font-medium text-muted-foreground">
        <Wrench className="h-3.5 w-3.5" /> My work orders ({workOrders.length})
      </div>
      <ul className="divide-y divide-border">
        {workOrders.map((wo) => (
          <li key={wo.id}>
            <Link
              to="/dashboard/category/assets-management"
              className="block px-4 py-2.5 text-sm hover:bg-accent/60"
            >
              <div className="truncate font-medium">{wo.title}</div>
              <div className="text-xs text-muted-foreground">
                {wo.assetName}
                {wo.dueDate ? ` · ${formatDateMedium(wo.dueDate)}` : ""}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
