import { getApiUrl } from "@/fetchers/get-api-url";

export type CalendarStatus = {
  configured: boolean;
  connected: boolean;
  email: string | null;
};

export function getCalendarConnectUrl() {
  return getApiUrl("google-calendar/connect");
}

export async function getCalendarStatus(): Promise<CalendarStatus> {
  const response = await fetch(getApiUrl("google-calendar/status"), {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export async function disconnectCalendar(): Promise<{ success: boolean }> {
  const response = await fetch(getApiUrl("google-calendar/disconnect"), {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}
