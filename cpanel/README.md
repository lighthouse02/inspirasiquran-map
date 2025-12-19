# cPanel (shared hosting) integration

This folder contains PHP scripts you can upload to your cPanel hosting so your **Netlify site (free)** can read activities, and your **Telegram bot** can write activities.

## Files

- `activities.php` – public read-only API that returns your `activities.json`
- `telegram-webhook.php` – Telegram webhook receiver that appends activities into `activities.json`
- `telegram-cron.php` – Telegram polling bot for cron (no webhook needed)

## Upload layout (recommended)

Create a folder on your hosting like:

```
public_html/api/
  activities.php
  telegram-webhook.php
  activities.json
```

Then your API endpoints become:

- `https://YOURDOMAIN.com/api/activities.php`
- `https://YOURDOMAIN.com/api/telegram-webhook.php`

## Step 1: Put `activities.json` on hosting

Copy your repo `activities.json` to `public_html/api/activities.json`.

## Step 2: Configure webhook token

Best: set `TELEGRAM_BOT_TOKEN` as an environment variable in cPanel (if your host supports it).

If not supported: edit `telegram-webhook.php` and hardcode `$BOT_TOKEN`.

## Step 3: Enable HTTPS

Telegram webhooks require HTTPS.

In cPanel:
- enable SSL (often Let's Encrypt)
- make sure `https://YOURDOMAIN.com/api/telegram-webhook.php` loads without warnings

## Step 4: Set Telegram webhook

Open in browser (replace values):

```
https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://YOURDOMAIN.com/api/telegram-webhook.php
```

You should see `{ "ok": true, ... }`.

## Alternative: Cron polling (no webhook)

If HTTPS/webhook is hard, use `telegram-cron.php`:

- In cPanel → Cron Jobs: run it every 1 minute.
- It will fetch updates from Telegram and process `/add`.
- It writes `telegram-offset.json` to remember the last update.

Example cron command (adjust PHP path to what your host provides):

```
/usr/local/bin/php -q /home/YOURCPANELUSER/public_html/api/telegram-cron.php
```

## Step 5: Update Netlify frontend

Point the frontend to your cPanel endpoint:

`https://YOURDOMAIN.com/api/activities.php`

(Next step: I can wire this directly in `index.html`.)

## Usage

In Telegram chat with your bot:

```
/add Distribution | 100 | USIM, Nilai | 2.8437,101.7837 | Alhamdulillah
```

Then refresh the Netlify site — the new activity appears.

## Notes / Limits

- This minimal flow doesn’t handle attachments yet.
- If your hosting blocks file writes, you may need to place `activities.json` in a writable folder and update paths.
