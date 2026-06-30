import { createFileRoute, redirect } from "@tanstack/react-router";
import { Boxes, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AssetDetailDialog } from "@/components/assets/asset-detail-dialog";
import { AssetFormDialog } from "@/components/assets/asset-form-dialog";
import { AssetSummary } from "@/components/assets/asset-summary";
import { DriverRegistry } from "@/components/assets/driver-registry";
import { LocationsManager } from "@/components/assets/locations-manager";
import { StockTakeView } from "@/components/assets/stock-take-view";
import { WorkOrderBoard } from "@/components/assets/work-order-board";
import Layout from "@/components/common/layout";
import PageTitle from "@/components/page-title";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ColoredAvatar } from "@/components/ui/colored-avatar";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { getMyPageAccess } from "@/fetchers/workspace-access";
import { useAsset } from "@/hooks/queries/asset-registry/use-asset";
import {
  useAssetSummary,
  useAssets,
} from "@/hooks/queries/asset-registry/use-assets";
import {
  buildLocationPaths,
  useLocations,
} from "@/hooks/queries/asset-registry/use-locations";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import {
  ASSET_CATEGORIES,
  ASSET_STATUSES,
  labelOf,
  STATUS_TONES,
} from "@/lib/asset-constants";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";
import { formatDateMedium } from "@/lib/format";

const SLUG = "assets-management";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/category/assets-management",
)({
  beforeLoad: async ({ context }) => {
    const session = await authClient.getSession();
    const workspaceId = session?.data?.session?.activeOrganizationId;
    if (!workspaceId) return;
    const access = await context.queryClient.ensureQueryData({
      queryKey: ["page-access", "me", workspaceId],
      queryFn: () => getMyPageAccess(workspaceId),
    });
    if (!access.isAdmin && !access.pages.includes(SLUG)) {
      throw redirect({ to: "/dashboard/home" });
    }
  },
  component: AssetsPage,
});

function AssetsPage() {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const { data: assets = [], isLoading } = useAssets(workspaceId);
  const { data: locations = [] } = useLocations(workspaceId);
  const locationPaths = buildLocationPaths(locations);
  const { data: summary } = useAssetSummary(workspaceId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<
    "registry" | "work-orders" | "drivers" | "locations" | "stock-take"
  >("registry");
  // Prefetch detail when a row is hovered/opened for snappier UX.
  useAsset(workspaceId, selectedId);

  const title = t("navigation:sidebar.categories.assetsManagement", {
    defaultValue: "Assets Management",
  });

  return (
    <>
      <PageTitle title={title} />
      <Layout>
        <Layout.Header>
          <div className="flex w-full items-center gap-1">
            <SidebarTrigger className="-ml-1 h-6 w-6" />
            <Separator
              orientation="vertical"
              className="mx-1.5 data-[orientation=vertical]:h-2.5"
            />
            <h1 className="text-xs text-card-foreground">{title}</h1>
          </div>
        </Layout.Header>
        <Layout.Content>
          <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="inline-flex rounded-lg border border-border p-0.5 text-sm">
                <button
                  type="button"
                  onClick={() => setView("registry")}
                  className={cn(
                    "rounded-md px-3 py-1",
                    view === "registry" && "bg-muted font-medium",
                  )}
                >
                  Registry
                </button>
                <button
                  type="button"
                  onClick={() => setView("work-orders")}
                  className={cn(
                    "rounded-md px-3 py-1",
                    view === "work-orders" && "bg-muted font-medium",
                  )}
                >
                  Work orders
                </button>
                <button
                  type="button"
                  onClick={() => setView("drivers")}
                  className={cn(
                    "rounded-md px-3 py-1",
                    view === "drivers" && "bg-muted font-medium",
                  )}
                >
                  Drivers
                </button>
                <button
                  type="button"
                  onClick={() => setView("locations")}
                  className={cn(
                    "rounded-md px-3 py-1",
                    view === "locations" && "bg-muted font-medium",
                  )}
                >
                  Locations
                </button>
                <button
                  type="button"
                  onClick={() => setView("stock-take")}
                  className={cn(
                    "rounded-md px-3 py-1",
                    view === "stock-take" && "bg-muted font-medium",
                  )}
                >
                  Stock-take
                </button>
              </div>
              {view === "registry" && (
                <AssetFormDialog
                  workspaceId={workspaceId}
                  trigger={
                    <Button size="sm">
                      <Plus className="h-4 w-4" /> Register asset
                    </Button>
                  }
                />
              )}
            </div>

            {view === "registry" ? (
              <>
                {summary && <AssetSummary summary={summary} />}

                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Serial</th>
                        <th className="px-3 py-2 font-medium">Name</th>
                        <th className="px-3 py-2 font-medium">Category</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium">Custodian</th>
                        <th className="px-3 py-2 font-medium">Location</th>
                        <th className="px-3 py-2 font-medium">Next renewal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assets.map((asset) => (
                        <tr
                          key={asset.id}
                          onClick={() => setSelectedId(asset.id)}
                          className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                        >
                          <td className="px-3 py-2 font-mono text-xs">
                            {asset.serialNumber}
                          </td>
                          <td className="px-3 py-2 font-medium">
                            {asset.name}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {labelOf(ASSET_CATEGORIES, asset.category)}
                          </td>
                          <td className="px-3 py-2">
                            <Badge
                              className={cn(
                                "border",
                                STATUS_TONES[asset.status],
                              )}
                            >
                              {labelOf(ASSET_STATUSES, asset.status)}
                            </Badge>
                          </td>
                          <td className="px-3 py-2">
                            {asset.custodianName ? (
                              <span className="flex items-center gap-1.5">
                                <ColoredAvatar
                                  name={asset.custodianName}
                                  image={asset.custodianImage}
                                  seed={asset.currentCustodianId ?? ""}
                                  className="h-5 w-5"
                                  fallbackClassName="text-[9px]"
                                />
                                <span className="truncate">
                                  {asset.custodianName}
                                </span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {asset.locationId
                              ? (locationPaths.get(asset.locationId) ?? "—")
                              : asset.location || "—"}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {asset.nextRenewalDate
                              ? formatDateMedium(asset.nextRenewalDate)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {isLoading && (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  {!isLoading && assets.length === 0 && (
                    <div className="flex flex-col items-center gap-2 py-12 text-center">
                      <Boxes className="h-8 w-8 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        No assets registered yet.
                      </p>
                    </div>
                  )}
                </div>
              </>
            ) : view === "work-orders" ? (
              <WorkOrderBoard
                workspaceId={workspaceId}
                onOpenAsset={setSelectedId}
              />
            ) : view === "drivers" ? (
              <DriverRegistry workspaceId={workspaceId} />
            ) : view === "locations" ? (
              <LocationsManager workspaceId={workspaceId} />
            ) : (
              <StockTakeView workspaceId={workspaceId} />
            )}
          </div>
        </Layout.Content>
      </Layout>

      <AssetDetailDialog
        workspaceId={workspaceId}
        assetId={selectedId}
        onClose={() => setSelectedId(null)}
      />
    </>
  );
}
