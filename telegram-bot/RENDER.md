# Deploy the Telegram bot on Render (paid)

This runs the bot as an always-on worker so you get the full guided flow.

## 1) Create a Background Worker

In Render:
- New + → **Background Worker**
- Connect the GitHub repo
- **Root Directory**: `telegram-bot`

## 2) Build + Start

- Build Command: `npm ci`
- Start Command: `npm start`

(We set `npm start` to run `server-guided.js`.)

## 3) Environment variables

Set these in Render → Environment:

- `TELEGRAM_BOT_TOKEN` = your bot token
- `DATABASE_URL` = your Neon Postgres connection string

Optional:
- `ALLOWED_TELEGRAM_IDS` = comma-separated chat/user IDs (example: `12345,67890`)

## 4) IMPORTANT: webhook vs polling

`server-guided.js` runs Telegram in **polling** mode.

If you previously configured a webhook to Netlify, delete it or polling may not behave as expected.

Open in a browser:

`https://api.telegram.org/bot<YOUR_TOKEN>/deleteWebhook?drop_pending_updates=true`

(After this, Render polling owns the bot.)

## 5) Verify

1. Deploy Render worker
2. In Telegram, send:
   - `/start`
   - `/add` or `/new`
3. Confirm ✅
4. Verify your Netlify site updates (it reads from `/.netlify/functions/get-activities` which reads Neon).

## Notes

- Don’t run the bot locally at the same time as Render polling.
- Attachments still require a public URL to show on the Netlify site (local downloads in Render aren’t public).