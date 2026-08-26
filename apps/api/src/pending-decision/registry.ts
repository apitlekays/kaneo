import { correspondenceProvider } from "./providers/correspondence";
import { meetingActionProvider } from "./providers/meeting-action";
import { minuteActionProvider } from "./providers/minute-action";
import { taskProvider } from "./providers/task";
import type { PendingDecisionProvider } from "./types";

/** Add a module here when it has work that awaits a user's decision. */
export const providers: PendingDecisionProvider[] = [
  correspondenceProvider,
  taskProvider,
  minuteActionProvider,
  meetingActionProvider,
];
