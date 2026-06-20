# Bytebeacons Codebase Audit Report

**Date:** 2026-06-21  
**App:** https://bytebeacons.online  
**Stack:** React + Express + TypeScript + Drizzle ORM + ElevenLabs / Twilio / Plivo

---

## Summary

| Severity | Count |
|----------|-------|
| Critical — broken feature | 3 |
| Warning — degraded UX | 6 |
| Minor — code quality | 4 |
| **Total** | **13** |

---

## Critical Issues

### 1. Campaign Scheduling Is Completely Broken

**Files:**
- `client/src/components/CreateCampaignDialog.tsx`
- `server/routes/campaign-routes.ts` (line ~140)

**Problem:**  
The frontend sends these fields when creating a scheduled campaign:
```
scheduleEnabled
scheduleTimeStart
scheduleTimeEnd
scheduleDays
scheduleTimezone
```
The server does not accept or store any of them. The schedule is silently dropped — the campaign saves but runs immediately or never, depending on setup.

**Fix:**  
1. In `campaign-routes.ts`, add the scheduling fields to the `POST /api/campaigns` handler and validate/store them.
2. Add a `scheduledFor` or `scheduleConfig` column to the campaigns table if not already present.
3. Make sure the campaign executor reads those fields before dialing.

---

### 2. Global `staleTime: Infinity` — All Data Goes Stale Silently

**File:** `client/src/lib/queryClient.ts` (line 251)

**Problem:**  
```typescript
staleTime: Infinity,  // Global default for ALL queries
```
Once any query loads, it is never re-fetched by React Query — not on window focus, not after time, not on navigation. Mutations that call `invalidateQueries` still work, but anything that doesn't invalidate explicitly will show outdated data forever within a session.

**Affected pages:** Dashboard, Campaigns list, Agents list, Analytics, Billing balance, Contacts.

**Fix:**  
Override `staleTime` per query where freshness matters:

| Query | Recommended staleTime |
|-------|-----------------------|
| `/api/dashboard` | `30_000` (30 s) |
| `/api/campaigns` | `0` |
| `/api/agents` | `0` |
| `/api/calls` | `60_000` (1 min) |
| `/api/analytics` | `300_000` (5 min) |
| `/api/plans` | `300_000` (5 min) |
| `/api/credit-transactions` | `60_000` (1 min) |

Example:
```typescript
const { data: campaigns } = useQuery({
  queryKey: ["/api/campaigns"],
  staleTime: 0,   // <-- add this
});
```

---

### 3. Phone Numbers Not Refreshed When Create Campaign Dialog Opens

**File:** `client/src/components/CreateCampaignDialog.tsx`

**Problem:**  
```typescript
const { data: phoneNumbers = [] } = useQuery<PhoneNumber[]>({
  queryKey: ["/api/phone-numbers"],
  enabled: open,
  // Missing staleTime: 0
});
```
`staleTime: Infinity` is inherited. If the user bought a new phone number and then opens the campaign dialog, the old cached list is shown — the new number does not appear without a page reload.

**Fix:**
```typescript
const { data: phoneNumbers = [] } = useQuery<PhoneNumber[]>({
  queryKey: ["/api/phone-numbers"],
  enabled: open,
  staleTime: 0,   // <-- add this
});
```

---

## Warning Issues

### 4. Analytics Page Bypasses Token Refresh Logic

**File:** `client/src/pages/Analytics.tsx` (line 69)

**Problem:**  
```typescript
// Raw fetch — does NOT go through apiRequest()
const response = await fetch(`/api/analytics?timeRange=${timeRange}&callType=${callType}`, {
  ...
});
if (!response.ok) throw new Error('Failed to fetch analytics data');
```
The shared `apiRequest()` function in `queryClient.ts` handles JWT expiry and triggers a token refresh automatically. This raw `fetch()` call bypasses that, so if the user's token expires while on the analytics page, it fails silently with no retry and no error message.

**Fix:**  
Replace the raw `fetch()` with `apiRequest()`:
```typescript
import { apiRequest } from "@/lib/queryClient";

const response = await apiRequest("GET", `/api/analytics?timeRange=${timeRange}&callType=${callType}`);
```

---

### 5. Billing Page Shows Empty List on API Error

**File:** `client/src/pages/Billing.tsx` (lines 184–222)

**Problem:**  
```typescript
const { data: transactions } = useQuery<CreditTransaction[]>({
  queryKey: ["/api/credit-transactions"],
  // No error state handled
});

const { data: plans } = useQuery<Plan[]>({
  queryKey: ["/api/plans"],
  // No error state handled
});
```
If either query fails, the user sees an empty transaction history and no upgrade plans. There is no error message — they cannot tell if there's a problem or if the list is genuinely empty.

**Fix:**  
```typescript
const { data: transactions, isError: txError } = useQuery<CreditTransaction[]>({
  queryKey: ["/api/credit-transactions"],
});

// In JSX:
{txError && (
  <p className="text-destructive text-sm">Failed to load transaction history. Please refresh.</p>
)}
```
Apply the same pattern to the plans query.

---

### 6. SIP Phone Numbers Crash If API Returns Null Data

**File:** `client/src/components/CreateCampaignDialog.tsx` (line ~162)

**Problem:**  
```typescript
const sipPhoneNumbers = sipPhoneNumbersResponse?.data || [];
```
If the SIP API returns `{ success: false, data: null }`, accessing `.data` on a failed response is fine here, but subsequent `.map()` / `.filter()` calls on a non-array would throw. The `success` flag is never checked.

**Fix:**  
```typescript
const sipPhoneNumbers = sipPhoneNumbersResponse?.success
  ? (sipPhoneNumbersResponse.data ?? [])
  : [];
```

---

### 7. Team Member Session Never Re-Validated After Login

**File:** `client/src/App.tsx` (lines 619–677)

**Problem:**  
Team member authentication is validated once at component mount. If an admin revokes a team member's access server-side while the session is active, the member continues to have full frontend access until they manually log out or refresh.

**Fix:**  
Add a periodic re-validation (every 5 minutes) or re-validate on every route change:
```typescript
useEffect(() => {
  const interval = setInterval(() => {
    validateTeamSession();  // re-check with server
  }, 5 * 60 * 1000);
  return () => clearInterval(interval);
}, []);
```

---

### 8. Dashboard Data Never Auto-Refreshes

**File:** `client/src/pages/Dashboard.tsx`

**Problem:**  
The dashboard query inherits `staleTime: Infinity`. After the user creates a campaign, makes calls, or updates credits, the dashboard stats (total calls, leads, credit balance) do not update unless the page is manually refreshed.

**Fix:**  
```typescript
const { data: dashboard } = useQuery<DashboardData>({
  queryKey: ["/api/dashboard"],
  staleTime: 30_000,   // <-- refresh every 30 seconds
});
```

---

### 9. Contact CSV Upload Fails AFTER Upload, Not Before

**File:** `server/routes/campaign-routes.ts` (line ~186)

**Problem:**  
Plan contact limits are validated after the file is fully uploaded to the server. A user on a limited plan can waste time uploading a 10,000-row CSV only to get a plan limit error at the end.

**Fix:**  
Before processing the CSV, check the user's current contact count vs. plan limit and return an error immediately if the upload would exceed it:
```typescript
const currentCount = await storage.getUserContactCount(req.userId);
const planLimit = await storage.getUserPlanContactLimit(req.userId);
if (currentCount >= planLimit) {
  return res.status(403).json({ error: "Contact limit reached for your plan" });
}
```

---

## Minor Issues

### 10. Dead Mock Campaign Data in Campaigns.tsx

**File:** `client/src/pages/Campaigns.tsx` (lines 67–120)

**Problem:**  
There is a `mockCampaigns` array defined but never used in production. It is leftover from development and adds noise to the file.

**Fix:** Delete the `mockCampaigns` array and any references to it.

---

### 11. Admin Guard Silently Fails If User Has No Role Field

**File:** `client/src/App.tsx` (line 542)

**Problem:**  
```typescript
const hasAdminAccess = user.role === 'admin';
```
If the API ever returns a user object without a `role` field (e.g. older account, migration gap), `user.role` is `undefined`, `hasAdminAccess` is `false`, and the user is silently redirected. No error is shown or logged.

**Fix:**  
```typescript
const hasAdminAccess = user?.role === 'admin';
if (!user?.role) console.warn('[Auth] User object missing role field', user?.id);
```

---

### 12. CRM Column Preferences Go Stale Across Browser Tabs

**File:** `client/src/pages/CRMPage.tsx` (lines 139–150)

**Problem:**  
CRM column order and category preferences are fetched once on page load. If the user changes preferences in one tab, the other tab does not pick up the change without a full reload.

**Fix:**  
Add `staleTime: 0` to the preferences query and optionally use `refetchOnWindowFocus: true` for this specific query.

---

### 13. All Error Handlers Use `any` Type

**Files:** Multiple — `Campaigns.tsx`, `Agents.tsx`, `Billing.tsx`, and others

**Problem:**  
```typescript
onError: (error: any) => {
  toast({ description: error.message });
}
```
Using `any` hides type errors. The codebase has a proper `ApiError` type in `queryClient.ts` that should be used here.

**Fix:**  
```typescript
import type { ApiError } from "@/lib/queryClient";

onError: (error: ApiError) => {
  toast({ description: error.message ?? "Something went wrong" });
}
```

---

## Already Fixed (This Session)

| Issue | Fix Applied |
|-------|-------------|
| Agents not showing in Create Campaign dialog | Added `staleTime: 0` + `isLoading` guard in `CreateCampaignDialog.tsx` |
| Same fix for Edit Campaign dialog | Added `staleTime: 0` in `EditCampaignDialog.tsx` |
| Recording play button showing for calls with no audio | Added status/duration guards + `unavailableRecordingIds` state in `Calls.tsx` |
| `twilioSid` / `plivoCallUuid` not in Call type | Added fields to `Call` interface in `Calls.tsx` |

---

## Priority Order

| Priority | Issue | Effort |
|----------|-------|--------|
| P1 — Fix today | Campaign scheduling dropped by server | Medium |
| P1 — Fix today | Phone numbers stale in campaign dialog | 1 line |
| P1 — Fix today | Analytics raw fetch bypasses auth | 1 line |
| P2 — Fix this week | Dashboard staleTime | 1 line per query |
| P2 — Fix this week | Billing empty error states | Small |
| P2 — Fix this week | SIP null check | 1 line |
| P3 — Backlog | Team session re-validation | Small |
| P3 — Backlog | CSV upload pre-validation | Small |
| P3 — Backlog | Dead mock data, any types, admin guard | Trivial |
