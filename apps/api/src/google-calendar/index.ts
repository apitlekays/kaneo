import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { taskCalendarEventTable } from "../database/schema";
import {
  deleteConnection,
  getConnection,
  getValidAccessToken,
  saveConnection,
} from "./connection";
import {
  buildAuthUrl,
  deleteEvent,
  exchangeCodeForTokens,
  getUserInfo,
  isGoogleCalendarConfigured,
} from "./google-client";
import { syncAllTasksForUser } from "./sync";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function signState(value: string) {
  return crypto
    .createHmac("sha256", process.env.AUTH_SECRET || "")
    .update(value)
    .digest("base64url");
}

function makeState(userId: string) {
  const payload = `${userId}.${Date.now()}.${crypto.randomBytes(8).toString("hex")}`;
  return Buffer.from(`${payload}.${signState(payload)}`).toString("base64url");
}

function verifyState(state: string): string | null {
  try {
    const decoded = Buffer.from(state, "base64url").toString();
    const idx = decoded.lastIndexOf(".");
    if (idx < 0) return null;
    const payload = decoded.slice(0, idx);
    const sig = decoded.slice(idx + 1);
    const expected = signState(payload);
    if (
      sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      return null;
    }
    const [userId, ts] = payload.split(".");
    if (!userId || !ts || Date.now() - Number(ts) > STATE_TTL_MS) return null;
    return userId;
  } catch {
    return null;
  }
}

function clientRedirect(status: "connected" | "error") {
  const base = (
    process.env.KANEO_CLIENT_URL || "http://localhost:5173"
  ).replace(/\/+$/, "");
  return `${base}/dashboard/settings/account/connections?google=${status}`;
}

const googleCalendar = new Hono<{ Variables: { userId: string } }>()
  // Start the OAuth consent flow (browser navigation; user is authenticated).
  .get("/connect", async (c) => {
    if (!isGoogleCalendarConfigured()) {
      throw new HTTPException(503, {
        message: "Google integration is not configured on this instance.",
      });
    }
    const userId = c.get("userId");
    if (!userId) throw new HTTPException(401, { message: "Unauthorized" });
    return c.redirect(buildAuthUrl(makeState(userId)));
  })
  // OAuth redirect target. Exempted from the auth middleware — identity comes
  // from the signed state, not the session.
  .get("/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const userId = state ? verifyState(state) : null;

    if (!code || !userId) {
      return c.redirect(clientRedirect("error"));
    }

    try {
      const tokens = await exchangeCodeForTokens(code);
      if (!tokens.refresh_token) {
        // No refresh token (user previously consented) — can't sync offline.
        return c.redirect(clientRedirect("error"));
      }
      const info = await getUserInfo(tokens.access_token);
      await saveConnection(userId, {
        googleEmail: info.email ?? null,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        scope: tokens.scope ?? null,
      });
      // Backfill existing tasks onto the calendar (fire and forget).
      void syncAllTasksForUser(userId).catch((err) =>
        console.error("Initial calendar backfill failed:", err),
      );
      return c.redirect(clientRedirect("connected"));
    } catch (err) {
      console.error("Google Calendar callback failed:", err);
      return c.redirect(clientRedirect("error"));
    }
  })
  // Connection status for the current user.
  .get("/status", async (c) => {
    const userId = c.get("userId");
    if (!userId) throw new HTTPException(401, { message: "Unauthorized" });
    const connection = await getConnection(userId);
    return c.json({
      configured: isGoogleCalendarConfigured(),
      connected: Boolean(connection),
      email: connection?.googleEmail ?? null,
    });
  })
  // Disconnect: remove the synced events, the mappings, and the connection.
  .delete("/disconnect", async (c) => {
    const userId = c.get("userId");
    if (!userId) throw new HTTPException(401, { message: "Unauthorized" });

    const connection = await getConnection(userId);
    if (connection) {
      const mappings = await db
        .select()
        .from(taskCalendarEventTable)
        .where(eq(taskCalendarEventTable.userId, userId));
      try {
        const token = await getValidAccessToken(connection);
        for (const mapping of mappings) {
          try {
            await deleteEvent(token, mapping.calendarId, mapping.eventId);
          } catch (err) {
            console.error(
              "Failed to delete calendar event on disconnect:",
              err,
            );
          }
        }
      } catch (err) {
        console.error("Failed to refresh token on disconnect:", err);
      }
      await db
        .delete(taskCalendarEventTable)
        .where(eq(taskCalendarEventTable.userId, userId));
      await deleteConnection(userId);
    }

    return c.json({ success: true });
  });

export default googleCalendar;
