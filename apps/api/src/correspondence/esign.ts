import { createHash } from "node:crypto";
import forge from "node-forge";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { getObjectBytes, putLetterObject } from "../storage/s3";

/**
 * Org signing credentials (PEM) from env. Self-signed today; swap for a
 * qualified/CA-issued key+cert later without any code change. When unset,
 * signing is refused with a clear message rather than silently faked.
 */
export function loadSigningCredentials() {
  const keyB64 = process.env.GM_SIGNING_KEY_B64?.trim();
  const certB64 = process.env.GM_SIGNING_CERT_B64?.trim();
  if (!keyB64 || !certB64) return null;
  return {
    keyPem: Buffer.from(keyB64, "base64").toString("utf8"),
    certPem: Buffer.from(certB64, "base64").toString("utf8"),
  };
}

type LetterForPdf = {
  refNo: string | null;
  subject: string;
  type: string;
  recipientName: string | null;
  recipientOrg: string | null;
  letterDate: Date | null;
};

function wrapText(
  text: string,
  font: import("pdf-lib").PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim() === "") {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of rawLine.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

/**
 * Produce the letter PDF including a visible signature block. The block is part
 * of the signed bytes, so the signature covers exactly what a reader sees.
 */
export async function generateSignedLetterPdf(
  letter: LetterForPdf,
  bodyText: string,
  signerName: string,
  role: string,
  signedAt: Date,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 56;
  const maxWidth = pageWidth - margin * 2;

  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  const black = rgb(0.1, 0.1, 0.1);

  const line = (
    text: string,
    opts: {
      size?: number;
      font?: import("pdf-lib").PDFFont;
      gap?: number;
    } = {},
  ) => {
    const size = opts.size ?? 11;
    const useFont = opts.font ?? font;
    if (y < margin + 90) {
      page = pdf.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    page.drawText(text, { x: margin, y, size, font: useFont, color: black });
    y -= opts.gap ?? size + 5;
  };

  line(letter.refNo ?? "(unregistered)", { size: 10, font: bold });
  line(signedAt.toISOString().slice(0, 10), { size: 10 });
  y -= 8;
  if (letter.recipientName || letter.recipientOrg) {
    line(
      [letter.recipientName, letter.recipientOrg].filter(Boolean).join(", "),
      { size: 11 },
    );
    y -= 4;
  }
  line(letter.subject, { size: 13, font: bold });
  y -= 6;
  for (const l of wrapText(bodyText || "", font, 11, maxWidth)) {
    line(l, { size: 11 });
  }

  // Visible signature block.
  y = Math.max(y - 30, margin + 70);
  page.drawLine({
    start: { x: margin, y: y + 8 },
    end: { x: margin + 240, y: y + 8 },
    thickness: 0.5,
    color: black,
  });
  page.drawText(`Digitally signed by ${signerName}`, {
    x: margin,
    y: y - 6,
    size: 10,
    font: bold,
    color: black,
  });
  page.drawText(role, { x: margin, y: y - 20, size: 9, font, color: black });
  page.drawText(`${signedAt.toISOString()} · MAPIMCore`, {
    x: margin,
    y: y - 33,
    size: 8,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });

  return pdf.save();
}

export type SignatureManifest = {
  signerId: string;
  signerName: string;
  role: string;
  signedAt: string;
  documentSha256: string;
  algorithm: "RSA-SHA256";
  certSubject: string;
  signatureBase64: string;
};

/** Sign PDF bytes with the org private key; returns the manifest. */
export function signBytes(
  bytes: Uint8Array,
  signer: { signerId: string; signerName: string; role: string },
  signedAt: Date,
): SignatureManifest {
  const creds = loadSigningCredentials();
  if (!creds) throw new Error("Signing certificate not configured");
  const bin = forge.util.binary.raw.encode(bytes);
  const privateKey = forge.pki.privateKeyFromPem(creds.keyPem);
  const md = forge.md.sha256.create();
  md.update(bin);
  const signature = privateKey.sign(md);
  const cert = forge.pki.certificateFromPem(creds.certPem);
  const certSubject = cert.subject.attributes
    .map((a) => `${a.shortName}=${a.value}`)
    .join(", ");
  return {
    signerId: signer.signerId,
    signerName: signer.signerName,
    role: signer.role,
    signedAt: signedAt.toISOString(),
    documentSha256: createHash("sha256").update(bytes).digest("hex"),
    algorithm: "RSA-SHA256",
    certSubject,
    signatureBase64: forge.util.encode64(signature),
  };
}

/** Store the signed PDF and return its object key. */
export function storeSignedPdf(
  workspaceId: string,
  letterId: string,
  refNo: string | null,
  bytes: Uint8Array,
) {
  const filename = `${(refNo ?? letterId).replace(/[^A-Za-z0-9._-]+/g, "-")}-signed.pdf`;
  return putLetterObject(
    workspaceId,
    letterId,
    filename,
    "application/pdf",
    bytes,
  );
}

/** Re-verify a stored signature: hash the signed PDF + RSA-verify the manifest. */
export async function verifyStoredSignature(
  signedObjectKey: string,
  manifest: SignatureManifest,
) {
  const creds = loadSigningCredentials();
  if (!creds) return { ok: false, reason: "not-configured" };
  const bytes = await getObjectBytes(signedObjectKey);
  const currentHash = createHash("sha256").update(bytes).digest("hex");
  if (currentHash !== manifest.documentSha256)
    return { ok: false, reason: "hash-mismatch" };
  try {
    const bin = forge.util.binary.raw.encode(bytes);
    const md = forge.md.sha256.create();
    md.update(bin);
    const publicKey = forge.pki.certificateFromPem(creds.certPem)
      .publicKey as forge.pki.rsa.PublicKey;
    const ok = publicKey.verify(
      md.digest().bytes(),
      forge.util.decode64(manifest.signatureBase64),
    );
    return { ok, reason: ok ? undefined : "signature-invalid" };
  } catch {
    return { ok: false, reason: "verify-error" };
  }
}
