import { Router, type Request, type Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "../../db";
import { googleSheetsCredentials } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getDomain } from "../../utils/domain";
import {
  listUserSheets,
  listSheetTabs,
  getConnectionStatus,
  disconnectGoogleSheets,
  getGoogleCredentials,
} from "./google-sheets.service";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

const STATE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getRedirectUri(req: Request): string {
  const domain = getDomain(req.headers.host as string);
  const proto = domain.startsWith("http") ? "" : "https://";
  return `${proto}${domain}/app/google-callback`;
}

async function getStateSecret(): Promise<string> {
  // DB-stored Google client secret takes priority; env vars are fallback
  try {
    const creds = await getGoogleCredentials();
    if (creds?.clientSecret) return creds.clientSecret + "_google_state";
  } catch {}
  const base = process.env.GOOGLE_CLIENT_SECRET || process.env.JWT_SECRET;
  if (!base) throw new Error("No secret available for Google OAuth state signing");
  return base + "_google_state";
}

async function signState(userId: string): Promise<string> {
  const secret = await getStateSecret();
  const ts = Date.now();
  const payload = `${userId}:${ts}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(JSON.stringify({ payload, sig })).toString("base64url");
}

async function verifyState(stateParam: string): Promise<string | null> {
  try {
    const { payload, sig } = JSON.parse(Buffer.from(stateParam, "base64url").toString());
    const secret = await getStateSecret();
    const expectedSig = createHmac("sha256", secret).update(payload).digest("hex");
    // Timing-safe comparison prevents timing-based signature oracle attacks
    const sigBuf = Buffer.from(sig, "hex");
    const expectedBuf = Buffer.from(expectedSig, "hex");
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;
    const [userId, ts] = payload.split(":");
    if (!userId || Date.now() - parseInt(ts) > STATE_TTL_MS) return null;
    return userId;
  } catch {
    return null;
  }
}


// ────────────────────────────────────────────────────────────────────────────
// Authenticated router — all other endpoints require auth middleware in routes.ts
// ────────────────────────────────────────────────────────────────────────────
export const googleSheetsRouter = Router();

// Returns the Google OAuth URL as JSON so the frontend can initiate the redirect
// after authenticating via Bearer token (browser navigation cannot send auth headers)
googleSheetsRouter.get("/auth", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const authCreds = await getGoogleCredentials();
  if (!authCreds) {
    res.status(400).json({
      errorCode: "not_configured",
      error: "Google OAuth credentials are not configured. Please add your Client ID and Client Secret in Admin > Settings.",
    });
    return;
  }

  let state: string;
  try {
    state = await signState(userId);
  } catch {
    res.status(500).json({ error: "Server misconfiguration: cannot sign OAuth state." });
    return;
  }

  const redirectUri = getRedirectUri(req);
  const params = new URLSearchParams({
    client_id: authCreds.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });

  res.json({ url: `${GOOGLE_AUTH_URL}?${params.toString()}` });
});

// ── POST /exchange ───────────────────────────────────────────────────────────
// Called by the frontend /app/google-callback page (with Bearer auth already set)
// to exchange the OAuth authorization code for tokens.
googleSheetsRouter.post("/exchange", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { code, state: stateParam } = req.body as { code?: string; state?: string };

  if (!code || !stateParam) {
    res.status(400).json({ error: "Missing code or state parameter" });
    return;
  }

  const verifiedUserId = await verifyState(stateParam);
  if (!verifiedUserId) {
    res.status(400).json({ errorCode: "invalid_state", error: "OAuth state is invalid or expired. Please try connecting again." });
    return;
  }

  if (verifiedUserId !== userId) {
    res.status(403).json({ errorCode: "state_user_mismatch", error: "OAuth state does not match the authenticated user." });
    return;
  }

  const creds = await getGoogleCredentials();
  if (!creds) {
    res.status(400).json({ errorCode: "not_configured", error: "Google OAuth credentials are not configured." });
    return;
  }

  const { clientId, clientSecret } = creds;

  const domain = getDomain(req.headers.host as string);
  const proto = domain.startsWith("http") ? "" : "https://";
  const redirectUri = `${proto}${domain}/app/google-callback`;

  try {
    const tokenResp = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResp.ok) {
      const errText = await tokenResp.text();
      console.error("[GoogleSheets OAuth] Token exchange failed:", errText);
      res.status(502).json({ errorCode: "token_exchange_failed", error: "Failed to exchange authorization code with Google." });
      return;
    }

    const tokenData = await tokenResp.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    let refreshToken = tokenData.refresh_token ?? null;
    if (!refreshToken) {
      const [existing] = await db
        .select({ refreshToken: googleSheetsCredentials.refreshToken })
        .from(googleSheetsCredentials)
        .where(eq(googleSheetsCredentials.userId, userId))
        .limit(1);
      refreshToken = existing?.refreshToken ?? null;
    }

    if (!refreshToken) {
      console.warn("[GoogleSheets OAuth] No refresh token available for user:", userId);
      res.status(400).json({ errorCode: "no_refresh_token", error: "No refresh token received. Please revoke access in your Google account and try again." });
      return;
    }

    const userInfoResp = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const userInfo = userInfoResp.ok
      ? (await userInfoResp.json() as { email?: string })
      : { email: "Unknown" };

    const tokenExpiry = new Date(Date.now() + tokenData.expires_in * 1000);

    await db
      .insert(googleSheetsCredentials)
      .values({
        userId,
        accessToken: tokenData.access_token,
        refreshToken,
        tokenExpiry,
        connectedEmail: userInfo.email || "Unknown",
      })
      .onConflictDoUpdate({
        target: googleSheetsCredentials.userId,
        set: {
          accessToken: tokenData.access_token,
          refreshToken,
          tokenExpiry,
          connectedEmail: userInfo.email || "Unknown",
          updatedAt: new Date(),
        },
      });

    res.json({ success: true, email: userInfo.email || "Unknown" });
  } catch (err: any) {
    console.error("[GoogleSheets OAuth] Exchange error:", err.message);
    res.status(500).json({ errorCode: "server_error", error: "An unexpected error occurred during token exchange." });
  }
});

googleSheetsRouter.get("/status", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const status = await getConnectionStatus(userId);
  res.json(status);
});

googleSheetsRouter.delete("/disconnect", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  await disconnectGoogleSheets(userId);
  res.json({ success: true });
});

googleSheetsRouter.get("/sheets", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const sheets = await listUserSheets(userId);
  res.json(sheets);
});

googleSheetsRouter.get("/sheets/:spreadsheetId/tabs", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { spreadsheetId } = req.params;
  const tabs = await listSheetTabs(userId, spreadsheetId);
  res.json(tabs);
});
