import type { IntegrationPlugin } from "../types";
import { validateTelegramConfig } from "./config";
import {
  handleTaskCommentCreated,
  handleTaskCreated,
  handleTaskDescriptionChanged,
  handleTaskPriorityChanged,
  handleTaskStatusChanged,
  handleTaskTitleChanged,
} from "./events";

export const telegramPlugin: IntegrationPlugin = {
  type: "telegram",
  name: "Telegram",
  onTaskCreated: handleTaskCreated,
  onTaskStatusChanged: handleTaskStatusChanged,
  onTaskPriorityChanged: handleTaskPriorityChanged,
  onTaskTitleChanged: handleTaskTitleChanged,
  onTaskDescriptionChanged: handleTaskDescriptionChanged,
  onTaskCommentCreated: handleTaskCommentCreated,
  // validateTelegramConfig is synchronous and used synchronously elsewhere
  // (telegram-integration/index.ts, plugins/telegram/events.ts); wrap it here
  // rather than making it async, which is what IntegrationPlugin requires.
  validateConfig: async (config) => validateTelegramConfig(config),
};
