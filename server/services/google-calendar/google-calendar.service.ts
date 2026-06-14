import { db } from "../../db";
import { googleCalendarCredentials, appointmentSettings } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getGoogleCredentials } from "../google-sheets/google-sheets.service";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export interface CalendarAppointment {
  id: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  appointmentDate: string;
  appointmentTime: string;
  duration: number;
  serviceName: string | null;
  notes: string | null;
  status: string;
}

async function refreshCalendarToken(userId: string, force = false): Promise<string | null> {
  const [cred] = await db
    .select()
    .from(googleCalendarCredentials)
    .where(eq(googleCalendarCredentials.userId, userId))
    .limit(1);

  if (!cred) return null;

  const now = new Date();
  if (!force && cred.tokenExpiry > now) {
    return cred.accessToken;
  }

  const creds = await getGoogleCredentials();
  if (!creds) {
    console.error("[GoogleCalendar] Google OAuth credentials not configured");
    return null;
  }

  try {
    const resp = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: cred.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!resp.ok) {
      console.error("[GoogleCalendar] Token refresh failed:", await resp.text());
      return null;
    }

    const data = await resp.json() as { access_token: string; expires_in: number };
    const newExpiry = new Date(Date.now() + data.expires_in * 1000);

    await db
      .update(googleCalendarCredentials)
      .set({ accessToken: data.access_token, tokenExpiry: newExpiry, updatedAt: new Date() })
      .where(eq(googleCalendarCredentials.userId, userId));

    return data.access_token;
  } catch (err: any) {
    console.error("[GoogleCalendar] Token refresh error:", err.message);
    return null;
  }
}

function buildEventBody(apt: CalendarAppointment) {
  const dateStr = apt.appointmentDate;
  const timeStr = apt.appointmentTime.substring(0, 5);
  const startDateTime = `${dateStr}T${timeStr}:00`;

  const startMs = new Date(`${dateStr}T${timeStr}`).getTime();
  const endMs = startMs + apt.duration * 60 * 1000;
  const endDate = new Date(endMs);
  const endDateStr = endDate.toISOString().split("T")[0];
  const endTimeStr = endDate.toISOString().split("T")[1].substring(0, 5);
  const endDateTime = `${endDateStr}T${endTimeStr}:00`;

  const descParts: string[] = [
    `Phone: ${apt.contactPhone}`,
  ];
  if (apt.contactEmail) descParts.push(`Email: ${apt.contactEmail}`);
  if (apt.serviceName) descParts.push(`Service: ${apt.serviceName}`);
  descParts.push(`Duration: ${apt.duration} minutes`);
  if (apt.notes) descParts.push(`Notes: ${apt.notes}`);
  descParts.push(`\nBooked by AI agent via Diploy`);

  if (apt.status === "completed") {
    const completedAt = new Date().toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    });
    descParts.push(`\nCompleted at: ${completedAt}`);
  }

  const statusLabel = apt.status.charAt(0).toUpperCase() + apt.status.slice(1);

  return {
    summary: `${statusLabel}: ${apt.contactName}${apt.serviceName ? ` — ${apt.serviceName}` : ""}`,
    description: descParts.join("\n"),
    start: { dateTime: startDateTime, timeZone: "UTC" },
    end: { dateTime: endDateTime, timeZone: "UTC" },
  };
}

export async function createCalendarEvent(userId: string, apt: CalendarAppointment): Promise<string | null> {
  let token = await refreshCalendarToken(userId);
  if (!token) return null;

  const body = buildEventBody(apt);

  const doCreate = (t: string) =>
    fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  try {
    let resp = await doCreate(token);
    if (resp.status === 401) {
      const fresh = await refreshCalendarToken(userId, true);
      if (!fresh) return null;
      resp = await doCreate(fresh);
    }
    if (!resp.ok) {
      console.error("[GoogleCalendar] Create event failed:", await resp.text());
      return null;
    }
    const data = await resp.json() as { id: string };
    console.log(`📅 [GoogleCalendar] Created event ${data.id} for appointment ${apt.id}`);
    return data.id;
  } catch (err: any) {
    console.error("[GoogleCalendar] Create event error:", err.message);
    return null;
  }
}

export async function updateCalendarEvent(userId: string, eventId: string, apt: CalendarAppointment): Promise<boolean> {
  let token = await refreshCalendarToken(userId);
  if (!token) return false;

  const body = buildEventBody(apt);

  const doUpdate = (t: string) =>
    fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  try {
    let resp = await doUpdate(token);
    if (resp.status === 401) {
      const fresh = await refreshCalendarToken(userId, true);
      if (!fresh) return false;
      resp = await doUpdate(fresh);
    }
    if (!resp.ok) {
      console.error("[GoogleCalendar] Update event failed:", await resp.text());
      return false;
    }
    console.log(`📅 [GoogleCalendar] Updated event ${eventId}`);
    return true;
  } catch (err: any) {
    console.error("[GoogleCalendar] Update event error:", err.message);
    return false;
  }
}

export async function deleteCalendarEvent(userId: string, eventId: string): Promise<boolean> {
  let token = await refreshCalendarToken(userId);
  if (!token) return false;

  const doDelete = (t: string) =>
    fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${t}` },
    });

  try {
    let resp = await doDelete(token);
    if (resp.status === 401) {
      const fresh = await refreshCalendarToken(userId, true);
      if (!fresh) return false;
      resp = await doDelete(fresh);
    }
    if (resp.status === 404) {
      console.warn(`[GoogleCalendar] Event ${eventId} not found (already deleted?)`);
      return true;
    }
    if (!resp.ok) {
      console.error("[GoogleCalendar] Delete event failed:", await resp.text());
      return false;
    }
    console.log(`📅 [GoogleCalendar] Deleted event ${eventId}`);
    return true;
  } catch (err: any) {
    console.error("[GoogleCalendar] Delete event error:", err.message);
    return false;
  }
}

export async function isCalendarSyncEnabled(userId: string): Promise<boolean> {
  const [cred] = await db
    .select({ id: googleCalendarCredentials.id })
    .from(googleCalendarCredentials)
    .where(eq(googleCalendarCredentials.userId, userId))
    .limit(1);

  if (!cred) return false;

  const [settings] = await db
    .select({ syncToGoogleCalendar: appointmentSettings.syncToGoogleCalendar })
    .from(appointmentSettings)
    .where(eq(appointmentSettings.userId, userId))
    .limit(1);

  return settings?.syncToGoogleCalendar ?? false;
}

export async function getCalendarConnectionStatus(userId: string): Promise<{ connected: boolean; email?: string }> {
  const [cred] = await db
    .select({ connectedEmail: googleCalendarCredentials.connectedEmail })
    .from(googleCalendarCredentials)
    .where(eq(googleCalendarCredentials.userId, userId))
    .limit(1);

  if (!cred) return { connected: false };
  return { connected: true, email: cred.connectedEmail };
}

export async function disconnectGoogleCalendar(userId: string): Promise<void> {
  await db.delete(googleCalendarCredentials).where(eq(googleCalendarCredentials.userId, userId));
}
