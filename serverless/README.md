# ClipSend Feedback Proxy

A tiny [Cloudflare Worker](https://workers.cloudflare.com/) that receives
feedback from the ClipSend desktop app and forwards it to a Discord webhook.

**Why:** previously the app shipped `resources/.env` containing the raw
Discord webhook URL inside every installer. Anyone could extract it and spam
the channel. Now the app only knows this worker's public URL; the webhook
secret lives exclusively in the worker and can be rotated without shipping a
new build.

## What ships in the app

- The app POSTs `{ type, message, contact, version }` to the worker.
- The worker validates the payload, builds the Discord embed, and forwards it.
- The webhook URL **never** appears in the repo or the installer.

## 1. Deploy the worker

Requires a free [Cloudflare account](https://dash.cloudflare.com/sign-up).

```bash
cd serverless
npm i -g wrangler        # or use: npx wrangler

wrangler login
wrangler deploy          # prints your workers.dev URL, e.g. clipsend-feedback.xxxx.workers.dev

# Store the Discord webhook URL as a secret (paste the full URL, press Enter)
wrangler secret put DISCORD_WEBHOOK_URL
```

Test it:

```bash
curl -X POST https://clipsend-feedback.xxxx.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"type":"general","message":"Hello from the test harness!","version":"1.8.18"}'
```

## 2. Point the app at the worker

Edit `main/ipc-handlers.js` and replace the placeholder:

```js
const FEEDBACK_PROXY_URL = 'https://clipsend-feedback.xxxx.workers.dev';
```

That value is public (it's just the worker's address), so it is safe to
commit. Ship it in the next release.

## 3. Rotate the webhook (do this now, once)

The old webhook URL is already extractable from any previously-downloaded
installer (v1.8.13 → current). Assume it is compromised:

1. Open the **Discord server → Server Settings → Integrations → Webhooks**.
2. Click the **ClipSend Feedback** webhook → **Delete**. This immediately
   invalidates the old URL everywhere.
3. Click **New Webhook** → name it `ClipSend Feedback`, choose the channel
   where feedback should land → **Copy Webhook URL** → **Save**.
4. `wrangler secret put DISCORD_WEBHOOK_URL` with the new URL.

Now the old leaked URL returns `Unknown Webhook` and is dead.

## 4. Restrict the integration (defense in depth)

Even with the secret tucked into the worker, harden the channel:

- **Webhook-only permissions:** keep the webhook pointed at a channel that is
  `@everyone` read-only (no `Send Messages` permission for members) so only
  the webhook can post there. Do this in the channel's **Permissions**.
- **Don't grant the webhook `Manage Webhooks` / admin scopes** — it only
  needs the default "Send Messages" intent (Discord enforces this per-scope
  token; the copied URL only carries what you grant).
- **Disable link previews / webhook mentions abuse** if spam ever appears.
- Optional: watch the channel; if abuse starts, rotate again with step 3.

## 5. Free-tier notes

Cloudflare Workers' free plan (100k requests/day) is far more than this app
will ever need. No payment method is required to deploy.

## Privacy note

This changes nothing about what data is sent — the app already submits only
the text you type (type, message, optional contact, app version). It only
changes *how* that text reaches Discord. `PRIVACY.md` has been updated to
reflect the proxy.
