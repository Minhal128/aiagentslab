import { db } from "../../db";
import { googleSheetsCredentials } from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "../../storage";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const GOOGLE_DRIVE_API = "https://www.googleapis.com/drive/v3/files";

export interface GoogleSheet {
  id: string;
  name: string;
}

export interface GoogleSheetTab {
  title: string;
  sheetId: number;
}

/**
 * Reads Google OAuth client credentials from the database (global_settings),
 * falling back to environment variables so existing env-only setups continue to work.
 */
export async function getGoogleCredentials(): Promise<{ clientId: string; clientSecret: string } | null> {
  try {
    const [dbClientId, dbClientSecret] = await Promise.all([
      storage.getGlobalSetting("google_client_id"),
      storage.getGlobalSetting("google_client_secret"),
    ]);
    const clientId = (dbClientId?.value as string | undefined)?.trim() || process.env.GOOGLE_CLIENT_ID;
    const clientSecret = (dbClientSecret?.value as string | undefined)?.trim() || process.env.GOOGLE_CLIENT_SECRET;
    if (clientId && clientSecret) return { clientId, clientSecret };
  } catch (err: any) {
    console.error("[GoogleSheets] Failed to read credentials from DB, falling back to env:", err.message);
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (clientId && clientSecret) return { clientId, clientSecret };
  }
  return null;
}

async function refreshAccessToken(userId: string, force = false): Promise<string | null> {
  const [cred] = await db
    .select()
    .from(googleSheetsCredentials)
    .where(eq(googleSheetsCredentials.userId, userId))
    .limit(1);

  if (!cred) return null;

  const now = new Date();
  if (!force && cred.tokenExpiry > now) {
    return cred.accessToken;
  }

  const creds = await getGoogleCredentials();
  if (!creds) {
    console.error("[GoogleSheets] Google OAuth credentials not configured (DB or env)");
    return null;
  }
  const { clientId, clientSecret } = creds;

  try {
    const resp = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: cred.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!resp.ok) {
      console.error("[GoogleSheets] Token refresh failed:", await resp.text());
      return null;
    }

    const data = await resp.json() as { access_token: string; expires_in: number };
    const newExpiry = new Date(Date.now() + data.expires_in * 1000);

    await db
      .update(googleSheetsCredentials)
      .set({
        accessToken: data.access_token,
        tokenExpiry: newExpiry,
        updatedAt: new Date(),
      })
      .where(eq(googleSheetsCredentials.userId, userId));

    return data.access_token;
  } catch (err: any) {
    console.error("[GoogleSheets] Token refresh error:", err.message);
    return null;
  }
}

export async function listUserSheets(userId: string): Promise<GoogleSheet[]> {
  let token = await refreshAccessToken(userId);
  if (!token) return [];

  const doFetch = (t: string) => {
    const url = new URL(GOOGLE_DRIVE_API);
    url.searchParams.set("q", "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
    url.searchParams.set("fields", "files(id,name)");
    url.searchParams.set("orderBy", "modifiedTime desc");
    url.searchParams.set("pageSize", "100");
    return fetch(url.toString(), { headers: { Authorization: `Bearer ${t}` } });
  };

  try {
    let resp = await doFetch(token);
    if (resp.status === 401) {
      console.warn("[GoogleSheets] Got 401 on listUserSheets, forcing token refresh...");
      const fresh = await refreshAccessToken(userId, true);
      if (!fresh) return [];
      resp = await doFetch(fresh);
    }
    if (!resp.ok) {
      console.error("[GoogleSheets] List sheets failed:", await resp.text());
      return [];
    }
    const data = await resp.json() as { files: Array<{ id: string; name: string }> };
    return (data.files || []).map((f) => ({ id: f.id, name: f.name }));
  } catch (err: any) {
    console.error("[GoogleSheets] List sheets error:", err.message);
    return [];
  }
}

export async function listSheetTabs(userId: string, spreadsheetId: string): Promise<GoogleSheetTab[]> {
  let token = await refreshAccessToken(userId);
  if (!token) return [];

  const doFetch = (t: string) => {
    const url = `${GOOGLE_SHEETS_API}/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties(title,sheetId)`;
    return fetch(url, { headers: { Authorization: `Bearer ${t}` } });
  };

  try {
    let resp = await doFetch(token);
    if (resp.status === 401) {
      console.warn("[GoogleSheets] Got 401 on listSheetTabs, forcing token refresh...");
      const fresh = await refreshAccessToken(userId, true);
      if (!fresh) return [];
      resp = await doFetch(fresh);
    }
    if (!resp.ok) {
      console.error("[GoogleSheets] List tabs failed:", await resp.text());
      return [];
    }
    const data = await resp.json() as { sheets: Array<{ properties: { title: string; sheetId: number } }> };
    return (data.sheets || []).map((s) => ({
      title: s.properties.title,
      sheetId: s.properties.sheetId,
    }));
  } catch (err: any) {
    console.error("[GoogleSheets] List tabs error:", err.message);
    return [];
  }
}

/**
 * Reads the first row of the given sheet tab to check if headers already exist.
 * Returns:
 *   string[]   — the values found in row 1 (may be empty array = row is blank)
 *   null        — request failed (auth error, network error, etc.)
 */
async function readSheetRow1(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string
): Promise<string[] | null> {
  const range = encodeURIComponent(`${sheetName}!A1:Z1`);
  const url = `${GOOGLE_SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${range}`;
  try {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (resp.status === 401) return null; // distinguish auth failure from empty sheet
    if (!resp.ok) {
      console.warn(`[GoogleSheets] readSheetRow1 failed (${resp.status}) for sheet ${spreadsheetId}`);
      return null;
    }
    const data = await resp.json() as { values?: string[][] };
    return (data.values?.[0]) ?? [];
  } catch (err: any) {
    console.warn("[GoogleSheets] readSheetRow1 error:", err.message);
    return null;
  }
}

/**
 * Writes headerRow to row 1 of the given sheet tab only if row 1 is currently empty.
 * Safe to call on every flow-save — it will skip if headers already exist.
 * Returns true when headers were written, false when skipped or on error.
 */
export async function ensureSheetHeaders(
  userId: string,
  spreadsheetId: string,
  sheetName: string,
  headerRow: string[]
): Promise<boolean> {
  let token = await refreshAccessToken(userId);
  if (!token) {
    console.warn("[GoogleSheets] ensureSheetHeaders: no valid token for user:", userId);
    return false;
  }

  try {
    // Check if row 1 already has content.
    // readSheetRow1 returns null on auth/network errors (not the same as an empty row).
    let existing = await readSheetRow1(token, spreadsheetId, sheetName);

    // null = read failed — attempt a forced token refresh and one retry read
    if (existing === null) {
      console.warn(`[GoogleSheets] readSheetRow1 returned null for sheet ${spreadsheetId} tab "${sheetName}" — forcing token refresh`);
      const freshToken = await refreshAccessToken(userId, true);
      if (!freshToken) return false;
      token = freshToken;
      existing = await readSheetRow1(freshToken, spreadsheetId, sheetName);
      if (existing === null) {
        console.error(`[GoogleSheets] readSheetRow1 still failed after token refresh for sheet ${spreadsheetId}`);
        return false;
      }
    }

    if (existing.length > 0) {
      console.log(`[GoogleSheets] Header row already exists in "${sheetName}" — skipping write`);
      return false;
    }

    // Row 1 is empty — write the header using UPDATE (overwrite) so it goes into A1
    const range = encodeURIComponent(`${sheetName}!A1`);
    const url = `${GOOGLE_SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${range}?valueInputOption=USER_ENTERED`;
    let resp = await fetch(url, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [headerRow], range: `${sheetName}!A1` }),
    });

    // One-time retry on 401
    if (resp.status === 401) {
      const freshToken = await refreshAccessToken(userId, true);
      if (!freshToken) return false;
      resp = await fetch(url, {
        method: "PUT",
        headers: { Authorization: `Bearer ${freshToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values: [headerRow], range: `${sheetName}!A1` }),
      });
    }

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[GoogleSheets] ensureSheetHeaders write failed for sheet ${spreadsheetId} tab "${sheetName}":`, errText);
      return false;
    }

    console.log(`[GoogleSheets] Header row written to "${sheetName}" (${spreadsheetId}): [${headerRow.join(', ')}]`);
    return true;
  } catch (err: any) {
    console.error("[GoogleSheets] ensureSheetHeaders error:", err.message);
    return false;
  }
}

export async function appendRowToSheet(
  userId: string,
  spreadsheetId: string,
  sheetName: string,
  rowData: (string | number | null)[]
): Promise<boolean> {
  const token = await refreshAccessToken(userId);
  if (!token) {
    console.error("[GoogleSheets] No valid token for user:", userId);
    return false;
  }

  const doAppend = async (accessToken: string): Promise<Response> => {
    const range = encodeURIComponent(`${sheetName}!A1`);
    const url = `${GOOGLE_SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    return fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [rowData] }),
    });
  };

  try {
    let resp = await doAppend(token);

    // One-time retry on 401/invalid token (handles clock skew or revocation)
    if (resp.status === 401) {
      console.warn("[GoogleSheets] Got 401, forcing token refresh and retrying append...");
      const freshToken = await refreshAccessToken(userId, true);
      if (!freshToken) {
        console.error("[GoogleSheets] Force refresh failed — cannot append row");
        return false;
      }
      resp = await doAppend(freshToken);
    }

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("[GoogleSheets] Append row failed:", errText);
      return false;
    }

    return true;
  } catch (err: any) {
    console.error("[GoogleSheets] Append row error:", err.message);
    return false;
  }
}

export async function getConnectionStatus(userId: string): Promise<{ connected: boolean; email?: string }> {
  const [cred] = await db
    .select({ connectedEmail: googleSheetsCredentials.connectedEmail })
    .from(googleSheetsCredentials)
    .where(eq(googleSheetsCredentials.userId, userId))
    .limit(1);

  if (!cred) return { connected: false };
  return { connected: true, email: cred.connectedEmail };
}

export async function disconnectGoogleSheets(userId: string): Promise<void> {
  await db
    .delete(googleSheetsCredentials)
    .where(eq(googleSheetsCredentials.userId, userId));
}
