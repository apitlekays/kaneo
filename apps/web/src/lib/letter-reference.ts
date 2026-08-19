/**
 * Incoming letters are quoted by the sender's own reference, so that wins.
 * Outgoing letters are ours and carry only our number — showing an ERN there
 * would attribute someone else's reference to a letter we sent.
 */
export function letterReference(letter: {
  direction: string;
  refNo: string | null;
  externalRefNo: string | null;
}): string {
  if (letter.direction === "in")
    return letter.externalRefNo ?? letter.refNo ?? "—";
  return letter.refNo ?? "—";
}

export function referenceHeader(direction: "in" | "out"): string {
  return direction === "in" ? "ERN" : "Ref No.";
}
