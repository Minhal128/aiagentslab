# Fix Google OAuth — Allow All Users to Connect Google Calendar

## The Problem

Your Google OAuth app is in **Testing** mode.
Only approved test users can connect. Everyone else gets:

```
Error 403: access_denied
bytebeacons.online has not completed the Google verification process
```

---

## Step 1 — Open Google Cloud Console

1. Go to → https://console.cloud.google.com
2. Make sure you are in the **correct project** (check the dropdown at the very top)

---

## Step 2 — Go to OAuth Consent Screen

1. Click **"APIs & Services"** in the left sidebar
2. Click **"OAuth consent screen"**

---

## Step 3 — Publish the App

1. Look for the **Publishing Status** section
2. It currently says **"Testing"**
3. Click the **"Publish App"** button
4. A confirmation popup appears — click **"Confirm"**

> You do NOT need to complete Google verification to publish.
> Publishing simply removes the test-user restriction so any Google account can connect.

---

## Step 4 — Verify the Redirect URI

1. In the left sidebar click **"Credentials"**
2. Click on your **OAuth 2.0 Client ID** (the one used for bytebeacons.online)
3. Under **"Authorized redirect URIs"** confirm this URL is listed:

   ```
   https://bytebeacons.online/app/google-callback
   ```

4. If it is missing → click **"Add URI"** → paste the URL above → click **"Save"**

---

## Step 5 — Test the Connection

1. Go to your app → **Appointments → Settings (gear icon)**
2. Click **"Connect Google Calendar"**
3. Google will show a warning screen:

   ```
   ⚠️  This app isn't verified
   This app hasn't been verified by Google yet.
   ```

4. Click **"Advanced"**
5. Click **"Go to bytebeacons.online (unsafe)"**
6. Select your Google account and click **"Allow"**
7. Google Calendar is now connected

> This warning screen is shown once per user. It is normal for apps
> that have not yet completed Google's verification process.

---

## Step 6 (Optional) — Remove the Warning Screen Permanently

To remove the "unverified app" warning for all users, submit for Google verification:

1. Go back to **OAuth consent screen**
2. Click **"Prepare for verification"**
3. Make sure you have all of the following ready:
   - [ ] Privacy Policy URL — e.g. `https://bytebeacons.online/privacy`
   - [ ] App Homepage URL — `https://bytebeacons.online`
   - [ ] Support email address
4. Fill in all required fields and submit
5. Google reviews and approves in **1 to 6 weeks**
6. After approval the warning screen disappears for all users permanently

---

## Summary

| Status | Who Can Connect | Warning Shown |
|--------|----------------|---------------|
| Testing (current) | Only approved test users | Blocked entirely |
| Published / In Production (after Step 3) | Any Google account | One-time warning screen |
| Verified (after Step 6) | Any Google account | No warning |

**Do Steps 1–5 now** — takes about 5 minutes and fixes the issue immediately.

**Do Step 6 later** — before launching to real paying customers.
