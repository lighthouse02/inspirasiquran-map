const { Pool } = require('pg');

// Telegram webhook -> insert activities into Neon.
// This avoids running a long-lived bot process (no Render, no cPanel cron).
//
// Required env:
// - TELEGRAM_BOT_TOKEN
// - DATABASE_URL (or NETLIFY_DATABASE_URL)
//
// Optional env:
// - TELEGRAM_WEBHOOK_SECRET (recommended)
//   If set, requests must include ?secret=... (simple shared secret)

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const connectionString = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;

const pool = connectionString ? new Pool({ connectionString }) : null;

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

async function tgSendMessage(chatId, text) {
  if (!BOT_TOKEN) return;
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true
    })
  }).catch(() => {});
}

function parseAddCommand(text) {
  // /add <title> | <count> | <location> | <lat>,<lng> | <note>
  const rest = text.replace(/^\/add\b/i, '').trim();
  if (!rest) return { error: 'Usage: /add <title> | <count> | <location> | <lat>,<lng> | <note>' };

  const parts = rest.split('|').map(s => s.trim());
  const title = parts[0] || 'Activity';

  let count = null;
  if (parts[1] !== undefined && parts[1] !== '') {
    const n = Number(parts[1]);
    if (!Number.isNaN(n)) count = n;
  }

  const location = parts[2] || '';

  let lat = null;
  let lng = null;
  const latlng = parts[3] || '';
  if (latlng && latlng.includes(',')) {
    const [a, b] = latlng.split(',').map(s => s.trim());
    const la = Number(a);
    const ln = Number(b);
    if (!Number.isNaN(la) && !Number.isNaN(ln)) {
      lat = la;
      lng = ln;
    }
  }

  const note = parts[4] || '';

  return { title, count, location, lat, lng, note };
}

exports.handler = async function (event) {
  try {
    if (WEBHOOK_SECRET) {
      const qs = event.queryStringParameters || {};
      if (!qs.secret || qs.secret !== WEBHOOK_SECRET) {
        return json(401, { ok: false, error: 'unauthorized' });
      }
    }

    if (!BOT_TOKEN) {
      return json(500, { ok: false, error: 'Missing TELEGRAM_BOT_TOKEN' });
    }
    if (!pool) {
      return json(500, { ok: false, error: 'Missing DATABASE_URL / NETLIFY_DATABASE_URL' });
    }

    const update = event.body ? JSON.parse(event.body) : null;
    if (!update) return json(200, { ok: true, ignored: true });

    const msg = update.message;
    if (!msg || !msg.chat || !msg.chat.id) return json(200, { ok: true, ignored: true });

    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();

    if (!text) return json(200, { ok: true, ignored: true });

    if (/^\/start\b/i.test(text) || /^\/help\b/i.test(text)) {
      await tgSendMessage(chatId, 'Commands:\n/add <title> | <count> | <location> | <lat>,<lng> | <note>');
      return json(200, { ok: true });
    }

    if (!/^\/add\b/i.test(text)) {
      await tgSendMessage(chatId, 'Commands:\n/add <title> | <count> | <location> | <lat>,<lng> | <note>');
      return json(200, { ok: true });
    }

    const parsed = parseAddCommand(text);
    if (parsed.error) {
      await tgSendMessage(chatId, parsed.error);
      return json(200, { ok: true, error: parsed.error });
    }

    const insert = `
      INSERT INTO activities (title, note, created_at, activity_date, count, location, latitude, longitude, raw)
      VALUES ($1, $2, NOW(), NOW(), $3, $4, $5, $6, $7)
      RETURNING id
    `;

    const raw = {
      source: 'telegram-webhook',
      chat_id: chatId,
      text
    };

    const res = await pool.query(insert, [
      parsed.title,
      parsed.note,
      parsed.count,
      parsed.location,
      parsed.lat,
      parsed.lng,
      raw
    ]);

    const id = res.rows && res.rows[0] && res.rows[0].id;
    await tgSendMessage(chatId, `Saved ✅\n${parsed.title}${id ? `\n${id}` : ''}`);

    return json(200, { ok: true, id });
  } catch (err) {
    console.error('telegram-webhook error', err);
    return json(500, { ok: false, error: String(err) });
  }
};
