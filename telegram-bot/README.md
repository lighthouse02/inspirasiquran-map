# InspirasiQuran Activity Bot

Simple Telegram bot to add activity items to `activities.json` used by the map.

Prerequisites
- Node.js (14+)

Setup

1. Install dependencies:

```bash
cd telegram-bot
npm install
```

2. Create a bot via BotFather and copy the bot token.

3. (Optional) Restrict which Telegram users can post by setting `ALLOWED_TELEGRAM_IDS` to a comma-separated list of numeric Telegram user IDs.

4. Start the bot (set token in environment):

```bash
setx TELEGRAM_BOT_TOKEN "<your-token>"
npm start
```

Usage from Telegram

- Add an activity:
  /add title | ISO-date | count | location | lat lng | note

Example:

/add Distribution start | 2025-12-26T00:00:00Z | 8000 | Ouagadougou, Burkina Faso | 12.3714277 -1.5196603 | Air arrival

The bot will append the item to `activities.json` and your site (if served from the repo) will reflect the change after deploy/refresh.

Guided interactive mode
-----------------------

There's a guided mode implemented in `server-guided.js` which provides a step-by-step conversational flow (title → date → count → location via sharing or text → optional photo/doc → note). To run it:

```bash
cd telegram-bot
export TELEGRAM_BOT_TOKEN='<your-token>'
# optional: export ALLOWED_TELEGRAM_IDS='12345678'
node server-guided.js
```

This mode downloads attachments to `telegram-bot/uploads` and stores attachment metadata in `activities.json`.

Mission categories
------------------

The guided bot supports a **Mission** field (used for recaps/reporting).

- During `/new`, the bot asks for Mission (title → mission → type → …)
- You can manage mission categories (DB-backed) via:
  - `/missions`
  - `/mission_add <name>`
  - `/mission_disable <name>` (temporarily stop generating recaps for that mission)
  - `/mission_enable <name>`

To enable DB-backed mission options, run `mission-schema.sql` in Neon:

- `telegram-bot/mission-schema.sql`

Daily Recap (Railway Cron)
-------------------------

There is a one-shot script that generates a daily recap draft and sends it for approval:

- Script: `recap-daily.js`
- Run locally: `npm run recap:daily`

It is designed to be run by a scheduler (recommended: Railway Cron) and **does not use polling**, so it won’t create Telegram 409 conflicts.

Approval flow

- Cron job creates a `recap_posts` row with `status='pending'` and sends the draft to an approver chat with buttons.
- Your always-on bot service (`server-guided.js`) receives the button callbacks:
  - Approve ✅ → posts to `TELEGRAM_PUBLIC_CHANNEL_ID`
  - Edit ✏️ → lets you send a replacement text, then you can approve
  - Cancel ❌ → marks canceled

Required environment variables

- `DATABASE_URL` (or `NETLIFY_DATABASE_URL`)
- `TELEGRAM_BOT_TOKEN`
- `RECAP_APPROVER_CHAT_ID` (your personal chat id, or a private admin group id)

Channel routing (recommended)

To ensure **only recaps** go to your public channel, and **each activity** goes to a private logs channel:

- `TELEGRAM_PUBLIC_CHANNEL_ID` — public channel (recap only)
- `TELEGRAM_LOG_CHANNEL_ID` — private logs channel (each activity announce)

Backward-compatible fallback:

- If you don't set the new vars, the bot falls back to `TELEGRAM_CHANNEL_ID` / `TELEGRAM_ANNOUNCE_CHAT_ID`.

Optional environment variables

- `RECAP_MISSION` (default `Syria`) — used when you want a single mission recap
- `RECAP_MISSIONS` (optional) — comma-separated missions to generate in one run, e.g. `Syria,Palestin,Quran`
  - If `RECAP_MISSIONS` is not set, the script will try to read missions from `mission_options` (if that table exists)
- `RECAP_TZ_OFFSET_MINUTES` (default `480` for Malaysia UTC+8)
- `RECAP_POST_EMPTY` (default `false`) — if `true`, posts even when there are no matching activities
- `BRAND_SIGNATURE_TEXT` (default `@inspirasiquranlive`)

Railway setup (recommended)

1. Create a **new Railway Cron Job** in the same project (separate from the polling bot service).
2. Set the start command to run from the `telegram-bot` folder:

  - Command: `cd telegram-bot && npm run recap:daily`

3. Set the schedule.

  Railway cron schedules are typically interpreted as UTC.
  - 10:00pm Malaysia time (MYT, UTC+8) = 14:00 UTC
  - Cron example: `0 14 * * *`

4. Add the required environment variables to the Cron Job.

5. Ensure your main bot service (`server-guided.js`) is running continuously (replicas=1) so it can handle Approve/Edit/Cancel button callbacks.

If Railway Cron UI is not available
----------------------------------

Some Railway projects/plans don't show a dedicated Cron Job feature.

Fallback: run a second **Empty Service** as a scheduler loop (it does NOT poll Telegram, so no 409 conflicts).

1. Create a new **Empty Service** in the same Railway project and connect it to the same repo.
2. Set Start Command:

  - Command: `cd telegram-bot && npm run recap:scheduler`

3. Add Variables to this scheduler service:

  - `DATABASE_URL`
  - `TELEGRAM_BOT_TOKEN`
  - `RECAP_APPROVER_CHAT_ID`
  - `RECAP_MISSION` (optional)
  - `RECAP_TZ_OFFSET_MINUTES` (optional, default 480)
  - `RECAP_RUN_LOCAL_HH` (optional, default 22)
  - `RECAP_RUN_LOCAL_MM` (optional, default 0)

This will trigger `recap-daily.js` once per day at the configured local time.

Notes

- The recap currently filters activities by:
  - `raw.mission === RECAP_MISSION` (preferred)
  - fallback: mission text in note/raw like "Misi Syria" or "Mission Syria" (for older records)
  - `raw.activity_type === "distribution"`.
  If you want it to work for older records that don’t have `activity_type`, we can add a fallback.
