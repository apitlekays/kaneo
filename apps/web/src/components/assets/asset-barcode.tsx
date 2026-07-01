import { QRCodeSVG } from "qrcode.react";
import Barcode from "react-barcode";

/**
 * Renders a Code 128 barcode (the serial, for inventory scanners) and a QR
 * code. The QR encodes `qrValue` — the public asset page URL — so scanning it
 * with a phone opens the asset's public info page; it falls back to the serial.
 */
export function AssetBarcode({
  serial,
  qrValue,
}: {
  serial: string;
  qrValue?: string;
}) {
  return (
    <div data-asset-label className="flex flex-wrap items-end gap-8">
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
          <QRCodeSVG value={qrValue || serial} size={112} />
        </div>
        <span className="text-xs text-muted-foreground">
          Scan for asset details
        </span>
      </div>
    </div>
  );
}
