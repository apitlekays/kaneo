/**
 * Thin Google OAuth + Calendar REST client (no SDK dependency).
 * Reuses the GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET already configured for
 * Google sign-in; the calendar scope is requested via a separate, per-user
 * "Connect" flow so logging in never demands calendar access.
 */
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

export function isGoogleCalendarConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
}

function getApiBaseUrl() {
  const direct = process.env.KANEO_API_URL?.trim();
  if (direct) return direct.replace(/\/+$/, "");
  const client = (
    process.env.KANEO_CLIENT_URL || "http://localhost:5173"
  ).replace(/\/+$/, "");
  return `${client}/api`;
}

export function getRedirectUri() {
  return `${getApiBaseUrl()}/google-calendar/callback`;
}

export function buildAuthUrl(state: string) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export type GoogleTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
};

export async function exchangeCodeForTokens(
  code: string,
): Promise<GoogleTokens> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      redirect_uri: getRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Google token exchange failed: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as GoogleTokens;
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<GoogleTokens> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Google token refresh failed: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as GoogleTokens;
}

export async function getUserInfo(
  accessToken: string,
): Promise<{ email?: string }> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return {};
  return (await res.json()) as { email?: string };
}

export type CalendarEventBody = {
  summary: string;
  description?: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  source?: { title?: string; url?: string };
};

async function calendarFetch(
  accessToken: string,
  method: string,
  path: string,
  body?: unknown,
) {
  const res = await fetch(`${CALENDAR_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

export async function insertEvent(
  accessToken: string,
  calendarId: string,
  event: CalendarEventBody,
): Promise<{ id: string }> {
  const res = await calendarFetch(
    accessToken,
    "POST",
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    event,
  );
  if (!res.ok) {
    throw new Error(
      `Calendar event insert failed: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as { id: string };
}

export async function updateEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  event: CalendarEventBody,
): Promise<{ id: string } | null> {
  const res = await calendarFetch(
    accessToken,
    "PUT",
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    event,
  );
  // Event was deleted on Google's side — signal the caller to recreate it.
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) {
    throw new Error(
      `Calendar event update failed: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as { id: string };
}

export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const res = await calendarFetch(
    accessToken,
    "DELETE",
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
  );
  // 404/410 = already gone, treat as success.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(
      `Calendar event delete failed: ${res.status} ${await res.text()}`,
    );
  }
}
