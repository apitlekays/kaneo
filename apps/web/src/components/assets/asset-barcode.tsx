import { QRCodeSVG } from "qrcode.react";
import Barcode from "react-barcode";

/** Renders both a Code 128 barcode and a QR code for an asset's serial. */
export function AssetBarcode({ serial }: { serial: string }) {
  return (
    <div className="flex flex-wrap items-end gap-8">
      <div className="flex flex-col items-center gap-2">
        <div className="rounded-md bg-white p-2">
          <Barcode
            value={serial}
            format="CODE128"
            height={56}
            width={1.6}
            fontSize={14}
            margin={4}
          />
        </div>
        <span className="text-xs text-muted-foreground">Code 128</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <div className="rounded-md bg-white p-3">
          <QRCodeSVG value={serial} size={112} />
        </div>
        <span className="text-xs text-muted-foreground">QR code</span>
      </div>
    </div>
  );
}
