import { eq } from "drizzle-orm";
import db from "../database";
import { googleCalendarConnectionTable } from "../database/schema";
import { refreshAccessToken } from "./google-client";

export type GoogleCalendarConnection =
  typeof googleCalendarConnectionTable.$inferSelect;

export async function getConnection(
  userId: string,
): Promise<GoogleCalendarConnection | undefined> {
  const [row] = await db
    .select()
    .from(googleCalendarConnectionTable)
    .where(eq(googleCalendarConnectionTable.userId, userId))
    .limit(1);
  return row;
}

export async function saveConnection(
  userId: string,
  data: {
    googleEmail?: string | null;
    accessToken: string;
    refreshToken: string;
    expiresAt: Date | null;
    scope?: string | null;
  },
) {
  await db
    .insert(googleCalendarConnectionTable)
    .values({ userId, ...data })
    .onConflictDoUpdate({
      target: googleCalendarConnectionTable.userId,
      set: {
        googleEmail: data.googleEmail,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
        scope: data.scope,
        updatedAt: new Date(),
      },
    });
}

export async function deleteConnection(userId: string) {
  await db
    .delete(googleCalendarConnectionTable)
    .where(eq(googleCalendarConnectionTable.userId, userId));
}

/**
 * Returns a currently-valid access token for the connection, refreshing (and
 * persisting the new token) when it is missing or within 60s of expiry.
 */
export async function getValidAccessToken(
  connection: GoogleCalendarConnection,
): Promise<string> {
  const stillValid =
    connection.accessToken &&
    connection.expiresAt &&
    connection.expiresAt.getTime() - Date.now() > 60_000;

  if (stillValid && connection.accessToken) {
    return connection.accessToken;
  }

  const refreshed = await refreshAccessToken(connection.refreshToken);
  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);

  await db
    .update(googleCalendarConnectionTable)
    .set({
      accessToken: refreshed.access_token,
      expiresAt,
      scope: refreshed.scope ?? connection.scope,
      updatedAt: new Date(),
    })
    .where(eq(googleCalendarConnectionTable.id, connection.id));

  return refreshed.access_token;
}
