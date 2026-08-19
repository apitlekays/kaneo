import * as v from "valibot";

/** The register records two urgency levels and no others. */
export const letterUrgencySchema = v.picklist(["urgent", "normal"]);
