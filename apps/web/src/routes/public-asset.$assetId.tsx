import { createFileRoute } from "@tanstack/react-router";
import { PackageX } from "lucide-react";
import PageTitle from "@/components/page-title";
import { KaneoBranding } from "@/components/public-project/kaneo-branding";
import { ThemeToggle } from "@/components/public-project/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { ColoredAvatar } from "@/components/ui/colored-avatar";
import { publicAssetImageUrl } from "@/fetchers/asset-registry";
import { usePublicAsset } from "@/hooks/queries/asset-registry/use-public-asset";
import {
  ASSET_CATEGORIES,
  ASSET_STATUSES,
  labelOf,
  STATUS_TONES,
} from "@/lib/asset-constants";
import { cn } from "@/lib/cn";

export const Route = createFileRoute("/public-asset/$assetId")({
  component: RouteComponent,
});

function DetailRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4 border-b border-border py-2.5 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value}</span>
    </div>
  );
}

function RouteComponent() {
  const { assetId } = Route.useParams();
  const { data: asset, isLoading, error } = usePublicAsset(assetId);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      </div>
    );
  }

  if (error || !asset) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <PageTitle title="Asset not found" />
        <PackageX className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Asset not found</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          This asset link is invalid or the asset no longer exists.
        </p>
      </div>
    );
  }

  return (
    <>
      <PageTitle title={`${asset.name} · ${asset.serialNumber}`} />
      <div className="flex min-h-screen flex-col bg-muted/30">
        <header className="sticky top-0 z-10 border-b border-border bg-background">
          <div className="mx-auto flex max-w-xl items-center justify-between gap-4 px-4 py-3">
            <span className="truncate text-sm font-medium text-muted-foreground">
              {asset.organizationName ?? "Asset registry"}
            </span>
            <ThemeToggle />
          </div>
        </header>

        <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">
          <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
            {asset.hasImage && (
              <div className="aspect-video w-full bg-muted">
                <img
                  src={publicAssetImageUrl(asset.id)}
                  alt={asset.name}
                  className="h-full w-full object-cover"
                />
              </div>
            )}

            <div className="space-y-5 p-5">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={cn("border", STATUS_TONES[asset.status])}>
                    {labelOf(ASSET_STATUSES, asset.status)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {labelOf(ASSET_CATEGORIES, asset.category)}
                  </span>
                </div>
                <h1 className="text-xl font-semibold leading-tight">
                  {asset.name}
                </h1>
                <p className="font-mono text-sm text-muted-foreground">
                  {asset.serialNumber}
                </p>
              </div>

              <div>
                <DetailRow label="Asset tag" value={asset.assetTag} />
                <DetailRow label="Manufacturer" value={asset.manufacturer} />
                <DetailRow label="Model" value={asset.model} />
                <DetailRow
                  label="Registration / plate"
                  value={asset.registrationNumber}
                />
                <DetailRow label="Location" value={asset.locationName} />
              </div>

              {asset.custodianName && (
                <div className="rounded-xl border border-border bg-muted/40 p-4">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Custodian
                  </p>
                  <div className="flex items-center gap-3">
                    <ColoredAvatar
                      name={asset.custodianName}
                      className="h-9 w-9"
                    />
                    <span className="text-sm font-medium">
                      {asset.custodianName}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>

        <footer className="border-t border-border">
          <div className="mx-auto max-w-xl px-4 py-3 text-center text-xs text-muted-foreground">
            <KaneoBranding />
          </div>
        </footer>
      </div>
    </>
  );
}
