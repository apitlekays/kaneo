import { Loader2, Pencil } from "lucide-react";
import { useState } from "react";
import { DateField } from "@/components/assets/date-field";
import { Button } from "@/components/ui/button";
import { ColoredAvatar } from "@/components/ui/colored-avatar";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Driver } from "@/fetchers/asset-registry";
import {
  useDriverMutations,
  useDrivers,
} from "@/hooks/queries/asset-registry/use-drivers";
import { cn } from "@/lib/cn";
import { formatDateMedium } from "@/lib/format";

export function DriverRegistry({ workspaceId }: { workspaceId: string }) {
  const { data: drivers = [], isLoading } = useDrivers(workspaceId);
  const now = Date.now();

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Drivers</h2>
        <p className="text-sm text-muted-foreground">
          Licence details for workspace members who drive assets. Expiry feeds
          reminders.
        </p>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Member</th>
                <th className="px-3 py-2 font-medium">Licence no.</th>
                <th className="px-3 py-2 font-medium">Class</th>
                <th className="px-3 py-2 font-medium">Expiry</th>
                <th className="px-3 py-2 font-medium">Phone</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {drivers.map((d) => {
                const overdue =
                  d.licenceExpiry && new Date(d.licenceExpiry).getTime() < now;
                return (
                  <tr
                    key={d.userId}
                    className="border-b border-border last:border-0 hover:bg-muted/20"
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <ColoredAvatar
                          name={d.name}
                          image={d.image}
                          seed={d.userId}
                          className="h-6 w-6"
                          fallbackClassName="text-[10px]"
                        />
                        <span className="truncate">{d.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {d.licenceNo || "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {d.licenceClass || "—"}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2",
                        overdue
                          ? "font-medium text-rose-500"
                          : "text-muted-foreground",
                      )}
                    >
                      {d.licenceExpiry
                        ? formatDateMedium(d.licenceExpiry)
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {d.phone || "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <DriverEditDialog driver={d} workspaceId={workspaceId} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DriverEditDialog({
  driver,
  workspaceId,
}: {
  driver: Driver;
  workspaceId: string;
}) {
  const [open, setOpen] = useState(false);
  const { save } = useDriverMutations(workspaceId);
  const [licenceNo, setLicenceNo] = useState(driver.licenceNo ?? "");
  const [licenceClass, setLicenceClass] = useState(driver.licenceClass ?? "");
  const [expiry, setExpiry] = useState<Date | null>(
    driver.licenceExpiry ? new Date(driver.licenceExpiry) : null,
  );
  const [phone, setPhone] = useState(driver.phone ?? "");

  const submit = () =>
    save.mutate(
      {
        userId: driver.userId,
        body: {
          licenceNo: licenceNo.trim() || null,
          licenceClass: licenceClass.trim() || null,
          licenceExpiry: expiry ? expiry.toISOString() : null,
          phone: phone.trim() || null,
        },
      },
      { onSuccess: () => setOpen(false) },
    );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Driver — {driver.name}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 px-6 pb-4">
          <div className="space-y-1.5">
            <Label>Licence number</Label>
            <Input
              value={licenceNo}
              onChange={(e) => setLicenceNo(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Class</Label>
              <Input
                value={licenceClass}
                onChange={(e) => setLicenceClass(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Expiry</Label>
              <DateField value={expiry} onChange={setExpiry} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
