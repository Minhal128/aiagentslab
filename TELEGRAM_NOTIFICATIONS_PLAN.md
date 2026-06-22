# Telegram Notifications — Implementation Plan

> **Difficulty: Easy.**
> No external SDK needed (plain `fetch` to Telegram's REST API).
> Follows patterns already in the codebase — mirrors how `NotificationService`, `webhookDeliveryService`, and global settings work.
> Estimated effort: **1–2 days**.

---

## What We're Building

When a platform event fires (campaign completed, call answered, appointment booked, etc.),
users receive an instant Telegram message — no webhook endpoint required on their side.

```
User connects Telegram bot  →  stores their chat_id
Event fires (e.g. campaign.completed)  →  triggerEvent() runs
  →  delivers webhooks (existing)
  →  also sends Telegram message (new)
```

---

## Architecture Overview

```
Admin Panel
  └── stores TELEGRAM_BOT_TOKEN in global_settings

User Settings Page
  └── shows unique connect-token
  └── user sends /connect <token> to bot
  └── bot webhook → matches token → saves chat_id

Event fires in business logic
  └── webhook-delivery.ts → triggerEvent()
        ├── deliver to user's webhook endpoints (existing)
        └── telegram-service.ts → send message to user's chat_id (new)
```

---

## Step-by-Step Implementation

---

### Step 1 — Create a Telegram Bot (5 minutes, one-time)

1. Open Telegram → search `@BotFather`
2. Send `/newbot` → follow prompts → get your **Bot Token**
3. Store it — you'll paste it in the admin panel in Step 3

---

### Step 2 — Database Schema

**File:** `shared/schema.ts`

Add one new table for per-user Telegram settings:

```ts
export const userTelegramSettings = pgTable("user_telegram_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  chatId: text("chat_id").notNull(),                        // Telegram chat ID
  isEnabled: boolean("is_enabled").notNull().default(true),
  selectedEvents: jsonb("selected_events").$type<string[]>().default([]), // empty = all events
  connectedAt: timestamp("connected_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

Add a connect-token table (used during the one-time pairing flow):

```ts
export const telegramConnectTokens = pgTable("telegram_connect_tokens", {
  token: varchar("token").primaryKey(),                     // random 6-char alphanumeric
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),             // 15-minute TTL
  usedAt: timestamp("used_at"),
});
```

Then add the corresponding types and insert schemas (same pattern as existing tables).

Run a migration after adding the tables:
```bash
npm run db:push
# or
npx drizzle-kit generate && npx drizzle-kit migrate
```

---

### Step 3 — Admin: Store Bot Token in Global Settings

**File:** `client/src/components/admin/SystemSettings.tsx` (or wherever Telegram settings go)

Add a new input field for `telegram_bot_token` — same pattern as `stripe_webhook_secret`, `razorpay_webhook_secret`, etc.

The admin saves the token via the existing `/api/admin/settings` endpoint. No new route needed.

Also add a `telegram_notifications_enabled` global flag (boolean) to allow disabling Telegram globally from the admin panel.

---

### Step 4 — Telegram Service

**New file:** `server/services/telegram-service.ts`

This is the core of the feature. Uses plain `fetch` — no npm package needed.

```ts
import { storage } from '../storage';

class TelegramService {
  private async getBotToken(): Promise<string | null> {
    const setting = await storage.getGlobalSetting('telegram_bot_token');
    return typeof setting?.value === 'string' ? setting.value : null;
  }

  // Send any message to a chat_id
  async sendMessage(chatId: string, text: string): Promise<boolean> {
    const token = await this.getBotToken();
    if (!token) return false;

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
        }),
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // Format and send an event notification to a specific user
  async notifyUser(userId: string, event: string, data: Record<string, any>): Promise<void> {
    // Check global kill-switch
    const globalEnabled = await storage.getGlobalSetting('telegram_notifications_enabled');
    if (globalEnabled?.value === false) return;

    // Get user's Telegram settings
    const settings = await storage.getUserTelegramSettings(userId);
    if (!settings || !settings.isEnabled) return;

    // Check if user subscribed to this event type (empty array = all events)
    if (settings.selectedEvents && settings.selectedEvents.length > 0) {
      if (!settings.selectedEvents.includes(event)) return;
    }

    const message = this.formatMessage(event, data);
    await this.sendMessage(settings.chatId, message);
  }

  // Register the bot webhook with Telegram so it receives /connect messages
  async registerWebhook(appUrl: string, token: string): Promise<boolean> {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/setWebhook`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: `${appUrl}/api/telegram/bot-webhook` }),
      }
    );
    return res.ok;
  }

  private formatMessage(event: string, data: Record<string, any>): string {
    // Maps each event to a human-readable Telegram message
    // Examples below — expand for all event types
    switch (event) {
      case 'campaign.completed':
        return `✅ <b>Campaign Completed</b>\n\n📋 <b>${data.campaign?.name || 'Campaign'}</b>\n` +
               `📞 Calls: ${data.campaign?.completedCalls ?? '?'} completed\n` +
               `🕐 ${new Date().toLocaleString()}`;

      case 'campaign.started':
        return `🚀 <b>Campaign Started</b>\n\n📋 <b>${data.campaign?.name || 'Campaign'}</b>\n` +
               `👥 Contacts: ${data.campaign?.totalContacts ?? '?'}`;

      case 'campaign.paused':
        return `⏸️ <b>Campaign Paused</b>\n\n📋 <b>${data.campaign?.name || 'Campaign'}</b>`;

      case 'campaign.failed':
        return `❌ <b>Campaign Failed</b>\n\n📋 <b>${data.campaign?.name || 'Campaign'}</b>\n` +
               `⚠️ ${data.error?.message || 'Unknown error'}`;

      case 'call.completed':
        return `📞 <b>Call Completed</b>\n\n` +
               `👤 ${data.contact?.name || data.call?.toNumber || 'Unknown'}\n` +
               `⏱️ Duration: ${data.call?.durationMinutes ?? 0} min\n` +
               `📊 ${data.analysis?.classification || ''}`;

      case 'appointment.booked':
        return `📅 <b>Appointment Booked</b>\n\n` +
               `👤 ${data.contact?.name || 'Unknown'}\n` +
               `🗓️ ${data.appointment?.scheduledDate} at ${data.appointment?.scheduledTime}`;

      case 'form.submitted':
        return `📝 <b>Form Submitted</b>\n\n` +
               `👤 ${data.contact?.name || 'Unknown'}\n` +
               `📋 ${data.form?.name || 'Form'}`;

      default:
        return `🔔 <b>Event: ${event}</b>\n🕐 ${new Date().toLocaleString()}`;
    }
  }
}

export const telegramService = new TelegramService();
```

---

### Step 5 — Storage Methods

**File:** `server/storage.ts`

Add these methods to the `IStorage` interface and `DatabaseStorage` class:

```ts
// Interface additions
getUserTelegramSettings(userId: string): Promise<UserTelegramSettings | undefined>;
saveTelegramSettings(userId: string, chatId: string, selectedEvents?: string[]): Promise<void>;
updateTelegramSettings(userId: string, updates: Partial<InsertUserTelegramSettings>): Promise<void>;
deleteTelegramSettings(userId: string): Promise<void>;

createTelegramConnectToken(userId: string): Promise<string>;  // returns the token
getTelegramConnectToken(token: string): Promise<TelegramConnectToken | undefined>;
markTelegramTokenUsed(token: string): Promise<void>;
```

Implementation follows the exact same pattern as `getUserWebhooks`, `createWebhook`, etc.

---

### Step 6 — Bot Webhook Route (Receives /connect Commands)

**New file:** `server/routes/telegram-bot-routes.ts`

This route receives POST requests from Telegram when someone messages your bot:

```ts
import { Router } from 'express';
import { storage } from '../storage';

export function createTelegramBotRoutes(): Router {
  const router = Router();

  // Telegram calls this when someone messages the bot
  router.post('/api/telegram/bot-webhook', async (req, res) => {
    res.sendStatus(200); // Always 200 immediately — Telegram retries on timeout

    const message = req.body?.message;
    if (!message?.text) return;

    const chatId = String(message.chat.id);
    const text = message.text.trim();

    // Handle /connect <token>
    if (text.startsWith('/connect')) {
      const token = text.split(' ')[1]?.trim().toUpperCase();
      if (!token) return;

      const connectToken = await storage.getTelegramConnectToken(token);
      if (!connectToken || connectToken.usedAt || new Date() > connectToken.expiresAt) {
        // Send error message back to user
        // (call telegramService.sendMessage here)
        return;
      }

      await storage.saveTelegramSettings(connectToken.userId, chatId);
      await storage.markTelegramTokenUsed(token);

      // Confirm to the user in Telegram
      // telegramService.sendMessage(chatId, '✅ Connected! You will now receive notifications here.');
    }

    if (text === '/stop') {
      await storage.deleteTelegramSettingsByChatId(chatId);
    }
  });

  return router;
}
```

Register in `server/routes.ts`:
```ts
import { createTelegramBotRoutes } from './routes/telegram-bot-routes';
// ...
app.use(createTelegramBotRoutes());
```

---

### Step 7 — User-Facing API Routes

**New file:** `server/routes/telegram-routes.ts`

```
GET  /api/telegram/status          → returns { connected, chatId, selectedEvents }
POST /api/telegram/connect-token   → generates a 6-char token (15 min TTL), returns it
PUT  /api/telegram/settings        → update selectedEvents, isEnabled
DELETE /api/telegram/disconnect    → removes chatId / settings
POST /api/telegram/test            → sends a test message to the user's chatId
```

All routes use `authenticateHybrid` (same as webhook routes).

Register in `server/routes.ts` alongside the user webhook routes.

---

### Step 8 — Hook Into triggerEvent()

**File:** `server/services/webhook-delivery.ts`

In the `triggerEvent()` method, add one line after the existing webhook delivery:

```ts
import { telegramService } from './telegram-service'; // add this import

async triggerEvent(userId, event, data, campaignId?) {
  // ... existing webhook delivery code (unchanged) ...

  // NEW: also notify via Telegram (fire-and-forget, non-blocking)
  telegramService.notifyUser(userId, event, data).catch(() => {});
}
```

That's the only change to existing code. Everything else is new files.

---

### Step 9 — Frontend: User Settings UI

**File:** `client/src/pages/WebhookConfigPage.tsx` (add a new tab)
**OR** create `client/src/pages/NotificationsPage.tsx`

The UI has three states:

**State A — Not connected:**
```
[Connect Telegram]
  → calls POST /api/telegram/connect-token
  → shows: "Send /connect ABCD12 to @YourBotName"
  → polls GET /api/telegram/status every 5s until connected
```

**State B — Connected:**
```
✅ Connected to Telegram

Event Filters (optional — leave empty for all):
  ☑ campaign.completed   ☑ call.completed   ☑ appointment.booked
  ☐ call.started         ☐ campaign.paused  ...

[Send Test Message]  [Disconnect]
```

**State C — Disabled by admin:**
```
ℹ️ Telegram notifications are not enabled on this platform.
```

---

### Step 10 — Admin Panel: Register Bot Webhook

**File:** `client/src/components/admin/SystemSettings.tsx`

Add a "Telegram" section with:
- `telegram_bot_token` input field (password type)
- `telegram_notifications_enabled` toggle
- A "Register Bot Webhook" button that calls:

```
POST /api/admin/telegram/register-webhook
  body: { appUrl: "https://yourdomain.com" }
```

This calls `telegramService.registerWebhook(appUrl, token)` which tells Telegram
where to send bot messages. **Must be done once after saving the bot token.**

---

## Files to Create / Modify

| Action | File |
|---|---|
| **Create** | `server/services/telegram-service.ts` |
| **Create** | `server/routes/telegram-routes.ts` (user API) |
| **Create** | `server/routes/telegram-bot-routes.ts` (bot webhook receiver) |
| **Modify** | `shared/schema.ts` — add 2 tables |
| **Modify** | `server/storage.ts` — add ~6 methods |
| **Modify** | `server/services/webhook-delivery.ts` — add 1 import + 1 line |
| **Modify** | `server/routes.ts` — register 2 new route files |
| **Modify** | `client/src/pages/WebhookConfigPage.tsx` (or new page) — add UI |
| **Modify** | `client/src/components/admin/SystemSettings.tsx` — bot token field |

---

## Why It's Easy to Execute

| Concern | Answer |
|---|---|
| **No new npm packages** | Telegram Bot API is plain HTTP — just `fetch` |
| **No new queue/worker** | Fire-and-forget alongside existing webhook delivery |
| **No auth complexity** | Token-based pairing (6-char, 15-min TTL) — simple and safe |
| **Isolated change** | Only 1 line added to existing code (`triggerEvent`) |
| **Follows existing patterns** | Storage methods, global settings, route structure all identical to existing webhook feature |
| **Rollback is trivial** | Remove the one line in `triggerEvent()` and the feature is silently disabled |

---

## Event Message Format (Quick Reference)

| Event | Telegram Message Preview |
|---|---|
| `campaign.completed` | ✅ **Campaign Completed** — Q1 Outreach — 487 calls |
| `campaign.failed` | ❌ **Campaign Failed** — Insufficient credits |
| `call.completed` | 📞 **Call Completed** — John Doe — 2 min — Warm Lead |
| `appointment.booked` | 📅 **Appointment Booked** — John Doe — Jan 15 at 2:00 PM |
| `form.submitted` | 📝 **Form Submitted** — Lead Qualification — Sarah W. |
| `inbound_call.missed` | 📵 **Missed Call** — +1 555 987 6543 |

---

## Execution Order (Recommended)

```
1. Create bot via @BotFather → get token          [5 min]
2. Add DB tables → run migration                  [20 min]
3. Add storage methods                            [30 min]
4. Write telegram-service.ts                      [45 min]
5. Write telegram-bot-routes.ts                   [20 min]
6. Write telegram-routes.ts (user API)            [30 min]
7. Register routes in routes.ts                   [5 min]
8. Add 1 line to webhook-delivery.ts              [2 min]
9. Add admin UI (bot token + register button)     [30 min]
10. Add user UI (connect flow + event selector)   [60 min]
```

**Total: ~4–5 hours of focused work.**
