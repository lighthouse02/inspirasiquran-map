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
