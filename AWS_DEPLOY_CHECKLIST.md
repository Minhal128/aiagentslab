# AWS Deployment Checklist — Plivo Campaign + Google Sheets Fixes

This checklist covers the three issues that were fixed locally and need to be
verified on the AWS deployment. Read this **before** you push / deploy and
**walk through it** immediately after the deploy is live.

---

## TL;DR

Three root causes were addressed:

1. **Plivo campaign not appearing in reports** — the `plivo_calls` table was
   the source of truth but the Reports / Calls page reads from the canonical
   `calls` table. A new `syncCallsRow()` helper mirrors the relevant fields
   from `plivo_calls` → `calls` after every Plivo call lifecycle event.
2. **Plivo recording not playable in reports** — the recording fetch route
   needs `plivoCallUuid` + `plivoCredentialId` in `calls.metadata`. These
   are now mirrored alongside the other call fields.
3. **Appointment created during a Plivo campaign not visible in the
   appointment schedule** — the OpenAI agent factory writes the appointment
   with `callId = plivo_call.id`, but the appointment scheduler / CRM code
   joins on `calls.id`. A new `relinkAppointmentsForPlivoCall()` helper
   patches the appointment to point at the canonical `calls.id`.

A new `GET /api/google-sheets/diagnostics` endpoint surfaces the exact
server-side Google OAuth configuration state (and performs a live Drive API
probe) so you can debug "Google Sheets not working" from the UI in seconds.

---

## Pre-deploy verification (do these locally first)

- [ ] `npx tsc --noEmit` — confirm only **pre-existing** errors remain
  (campaign-executor lines 437/583/3020/3094 and the messaging-plugins
  import errors). No errors in any of the 4 files I modified.
- [ ] `git diff --stat` should show changes in only these files:
  - `server/engines/plivo/services/plivo-call.service.ts` (+mirroring logic)
  - `server/services/campaign-executor.ts` (+2 lines, set engine type)
  - `server/services/google-sheets/google-sheets.routes.ts` (+diagnostics)
  - `server/services/google-sheets/google-sheets.service.ts` (+export)
  - `.env.example` (+Google OAuth docs)
- [ ] `npm run build` succeeds.

---

## Post-deploy verification (do these on AWS within 5 minutes of go-live)

### 1. Plivo-numbered campaign flow

- [ ] Log in as a user with a Plivo agent + Plivo phone number.
- [ ] Create a campaign with 2–3 contacts, set status to "started".
- [ ] Wait for calls to complete.
- [ ] Go to `/app/reports` and `/app/calls` — confirm the Plivo campaign
  rows appear (not empty, not stuck on "initiated").
- [ ] Open a single call's detail page — confirm:
  - Status is `completed` (or whatever Plivo returned)
  - Duration, transcript, AI summary are populated
  - Recording player loads and plays
  - "Lead classification" / sentiment appear
- [ ] If any row is missing data, run a one-off SQL check:

  ```sql
  SELECT c.id, c.status, c.duration, c.recording_url IS NOT NULL AS has_rec,
         c.metadata->>'plivoCallUuid' AS plivo_uuid
  FROM calls c
  WHERE c.campaign_id = '<campaign_id>'
  ORDER BY c.created_at DESC;
  ```

  `has_rec` and `plivo_uuid` should be true for completed calls.

### 2. Appointment scheduling on Plivo calls

- [ ] In the same Plivo campaign, configure the agent to have a
  "Schedule Appointment" tool.
- [ ] During a test call, ask the agent to book an appointment.
- [ ] Open `/app/appointments` — the appointment must appear.
- [ ] Verify the `appointments.call_id` matches the canonical `calls.id`
  (not the `plivo_calls.id`):

  ```sql
  SELECT a.id, a.call_id, c.metadata->>'plivoCallUuid' AS plivo_uuid
  FROM appointments a
  JOIN calls c ON c.id = a.call_id
  WHERE a.created_at > NOW() - INTERVAL '1 hour';
  ```

  Every row must have a non-null `plivo_uuid`.

### 3. Google Sheets integration

- [ ] Open `/app/integrations/google-sheets` (or whichever path your
  frontend uses) — confirm the "Connect" button appears.
- [ ] As admin, confirm the OAuth credentials are configured:
  - **Option A (recommended)**: Admin > Settings > Google OAuth — paste
    Client ID + Secret. This stores them in `global_settings`.
  - **Option B**: Set `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` in the
    AWS environment / .env, then restart the app.
- [ ] From your browser, hit
  `GET /api/google-sheets/diagnostics` (with auth) — the response must
  include `"oauthConfigured": true` and the `liveProbe.ok` should be
  `true` for an already-connected user, or `false` with the
  `suggestion` field explaining what to do.
- [ ] Click "Connect" — the Google consent screen must appear with the
  Sheets + Drive scopes.
- [ ] After consent, `/api/google-sheets/sheets` should return the user's
  spreadsheets. Pick one and confirm rows can be loaded.

### 4. Smoke test the other engines (regression check)

- [ ] **ElevenLabs campaign** — start a test campaign, confirm the call
  appears in reports and the recording plays.
- [ ] **Twilio+OpenAI campaign** — same.
- [ ] **Inbound calls** — call the Plivo number, confirm an `incoming_calls`
  row is created and shows up in `/app/calls` with `incoming` direction.
- [ ] **OpenAI widget** — embed a widget on a test page, confirm a call
  creates a `calls` row and that the reports page still shows it.

The `syncCallsRow` helper is **only invoked for Plivo** and the
`relinkAppointmentsForPlivoCall` helper **only patches appointments whose
`callId` matches a `plivoCalls.id`**, so no other engine is affected.

---

## AWS environment variables (final list)

The only new env vars introduced by this fix are documentation-only:
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are now documented in
`.env.example`. **They are not strictly required** — if the admin sets
them via the in-app Admin > Settings panel, that's enough. But for AWS
the env-var path is usually preferred, so set them in your ECS task
definition / Elastic Beanstalk environment / Secrets Manager:

```
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
```

In Google Cloud Console, the OAuth client's **Authorized redirect URI** must
include:

```
https://<your-aws-domain>/app/google-callback
```

---

## What to do if a check fails on AWS

| Symptom | Check | Fix |
| --- | --- | --- |
| Plivo campaign rows empty in reports | `SELECT count(*) FROM calls WHERE campaign_id IS NOT NULL AND created_at > NOW() - INTERVAL '1 hour';` | Should be > 0. If 0, the campaign-executor pre-insert is broken (revert not just the mirror but the executor itself). |
| Plivo recording 404 | `SELECT metadata->>'plivoCallUuid' FROM calls WHERE id = '<call_id>';` | If null, the `syncCallsRow` is being skipped. Check server logs for `[PlivoCall] syncCallsRow error`. |
| Appointments missing call link | `SELECT count(*) FROM appointments WHERE call_id IN (SELECT id FROM plivo_calls);` | Should be 0 after the fix (all should point at `calls.id`). If non-zero, the relink helper didn't run. |
| Google Sheets "not configured" | `curl https://<domain>/api/google-sheets/diagnostics` (with auth) | Check `oauthConfigured` and `oauthSource` (env vs database). |
| Type errors after deploy | `kubectl logs <pod> --previous` or CloudWatch logs | Should be none related to plivo-call.service.ts or google-sheets routes. |

---

## Rollback plan

If anything goes wrong on AWS, the rollback is one command:

```bash
git revert HEAD
npm run build
# redeploy
```

The mirror is purely additive: it only writes fields that weren't already
present, and it never downgrades status. Reverting it just means Plivo
campaigns stop showing in `/app/reports` again — no data loss, no
downtime.
