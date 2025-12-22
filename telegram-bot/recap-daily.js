/*
  Daily Recap (auto) for InspirasiQuran

  - Queries Neon Postgres for today's *distribution* activities for a mission (default: Syria)
  - Creates a pending recap draft and sends it to an approver
  - The always-on bot (server-guided.js) posts it to your public channel ONLY after approval
  - Designed for Railway Cron / one-shot execution (NO polling)

  Required env:
    - DATABASE_URL (or NETLIFY_DATABASE_URL)
    - TELEGRAM_BOT_TOKEN
    - RECAP_APPROVER_CHAT_ID

  Optional env:
    - RECAP_MISSION (default: "Syria")
    - RECAP_MISSIONS (comma-separated override, e.g. "Syria,Palestin,Quran")
    - RECAP_TZ_OFFSET_MINUTES (default: 480) // Malaysia UTC+8
    - RECAP_POST_EMPTY (default: "false")
    - BRAND_SIGNATURE_TEXT (default: "@inspirasiquranlive")
*/

const https = require('https');
const { Pool } = require('pg');

const DB_URL = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL || '';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

const RECAP_MISSION = String(process.env.RECAP_MISSION || 'Syria').trim();
const RECAP_MISSIONS = String(process.env.RECAP_MISSIONS || '').trim();
const RECAP_TZ_OFFSET_MINUTES = Number(process.env.RECAP_TZ_OFFSET_MINUTES || 480);
const RECAP_POST_EMPTY = String(process.env.RECAP_POST_EMPTY || 'false').toLowerCase() === 'true';
const BRAND_SIGNATURE_TEXT = String(process.env.BRAND_SIGNATURE_TEXT || '@inspirasiquranlive');
const RECAP_APPROVER_CHAT_ID = String(process.env.RECAP_APPROVER_CHAT_ID || '').trim();

function mustEnv(name, value){
  if(!value) throw new Error(`Missing required env var: ${name}`);
}

function escapeHtml(value){
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function simplifyPlaceName(location){
  const s = String(location || '').trim();
  if(!s) return '';
  const parts = s.split(',').map(p => p.trim()).filter(Boolean);
  return parts.length ? parts[0] : s;
}

function parseCountToNumber(countValue){
  // DB stores count as string; allow "1,200 Mushaf" etc
  const t = String(countValue ?? '').trim();
  if(!t) return null;
  const match = t.match(/\d[\d,._\s]*/);
  if(!match) return null;
  const numStr = match[0].replace(/[\s,._]/g, '');
  const n = Number(numStr);
  return Number.isFinite(n) ? n : null;
}

function startOfDayUtcRange(now = new Date(), tzOffsetMinutes = 0){
  // Compute [startUtc, endUtc) for the "local" day defined by tzOffsetMinutes.
  // localTime = utc + offset
  const offsetMs = tzOffsetMinutes * 60 * 1000;
  const localNow = new Date(now.getTime() + offsetMs);

  const y = localNow.getUTCFullYear();
  const m = localNow.getUTCMonth();
  const d = localNow.getUTCDate();

  const localStart = new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
  const localEnd = new Date(Date.UTC(y, m, d + 1, 0, 0, 0, 0));

  const startUtc = new Date(localStart.getTime() - offsetMs);
  const endUtc = new Date(localEnd.getTime() - offsetMs);
  return { startUtc, endUtc, localYMD: { y, m: m + 1, d } };
}

function telegramApiRequest(token, method, payload){
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        method: 'POST',
        path: `/bot${token}/${method}`,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length
        }
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try{
            const json = JSON.parse(data || '{}');
            if(!json.ok){
              return reject(new Error(`Telegram API error: ${data}`));
            }
            resolve(json);
          }catch(e){
            reject(new Error(`Telegram API invalid response: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function formatLocalDateLabel(ymd){
  // Example: "22 Dec 2025 (MYT)"
  try{
    const dt = new Date(Date.UTC(ymd.y, (ymd.m - 1), ymd.d, 0, 0, 0));
    const nice = dt.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
    return `${nice} (MYT)`;
  }catch(e){
    return `${ymd.d}-${ymd.m}-${ymd.y} (MYT)`;
  }
}

function pickBestHighlight(rows){
  // Prefer explicit highlights field. If multiple, pick the longest (usually most meaningful).
  const candidates = rows
    .map(r => String(r.highlights || '').trim())
    .filter(Boolean)
    .sort((a,b) => b.length - a.length);
  return candidates[0] || '';
}

function buildRecapHtml({ mission, dateLabel, activities, totalMushaf, topLocations, bestHighlight }){
  const DIV = '━━━━━━━━━━━━━━━━━━━━';
  const lines = [];

  lines.push(DIV);
  lines.push(`<b>Hari ini dalam Misi ${escapeHtml(mission)}…</b>`);
  lines.push(`<i>${escapeHtml(dateLabel)}</i>`);
  lines.push(DIV);
  lines.push('');

  lines.push(`📦 <b>Agihan hari ini:</b> ${activities.length} aktiviti`);
  if(totalMushaf > 0){
    lines.push(`📖 <b>Mushaf diagih:</b> ${escapeHtml(String(totalMushaf))}`);
  }

  if(topLocations.length){
    const locText = topLocations
      .slice(0, 3)
      .map(x => `${escapeHtml(x.name)} (${escapeHtml(String(x.count))})`)
      .join(', ');
    lines.push(`📍 <b>Lokasi:</b> ${locText}`);
  }

  if(bestHighlight){
    const quoted = `“${escapeHtml(bestHighlight).replace(/\r?\n/g, '<br>')}”`;
    lines.push('');
    lines.push(`💬 <b>Highlights:</b> <i>${quoted}</i>`);
  }

  lines.push('');
  lines.push('');
  lines.push(`<code>${escapeHtml(BRAND_SIGNATURE_TEXT)}</code>`);

  return lines.join('\n');
}

function parseMissionList(value){
  const raw = String(value || '').trim();
  if(!raw) return [];
  return raw
    .split(',')
    .map(s => String(s || '').trim())
    .filter(Boolean)
    .slice(0, 30);
}

async function getActiveMissionsFromDb(pool){
  // mission_options may not exist yet; treat as optional.
  try{
    const r = await pool.query(
      'SELECT name FROM mission_options WHERE active = true ORDER BY sort_order NULLS LAST, name ASC'
    );
    return (r.rows || []).map(x => String(x.name || '').trim()).filter(Boolean);
  }catch(e){
    return [];
  }
}

function escapeRegexLiteral(s){
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isDistributionActivity(activityType){
  return String(activityType || '').toLowerCase() === 'distribution';
}

function missionMatchesRow(row, mission){
  const m = String(mission || '').trim();
  if(!m) return false;
  const mLower = m.toLowerCase();

  // Preferred: explicit raw.mission
  if(row.raw_mission_lower && row.raw_mission_lower === mLower) return true;

  // Fallback: parse legacy note
  const noteText = String(row.note || '').trim();
  if(!noteText) return false;
  const missionRegex = new RegExp(`\\b(misi|mission)\\s*${escapeRegexLiteral(m)}\\b`, 'i');
  return missionRegex.test(noteText);
}

async function main(){
  mustEnv('DATABASE_URL (or NETLIFY_DATABASE_URL)', DB_URL);
  mustEnv('TELEGRAM_BOT_TOKEN', TELEGRAM_BOT_TOKEN);
  mustEnv('RECAP_APPROVER_CHAT_ID', RECAP_APPROVER_CHAT_ID);

  const { startUtc, endUtc, localYMD } = startOfDayUtcRange(new Date(), RECAP_TZ_OFFSET_MINUTES);
  const dateLabel = formatLocalDateLabel(localYMD);

  const pool = new Pool({ connectionString: DB_URL });

  // Mission list priority:
  // 1) RECAP_MISSIONS (explicit override)
  // 2) mission_options table (dynamic)
  // 3) RECAP_MISSION (single)
  let missions = parseMissionList(RECAP_MISSIONS);
  if(missions.length === 0){
    missions = await getActiveMissionsFromDb(pool);
  }
  if(missions.length === 0){
    missions = [RECAP_MISSION].filter(Boolean);
  }

  // NOTE: raw is stored as JSON string by the bot.
  // We extract fields from raw::jsonb when possible.
  const q = `
    SELECT
      id,
      title,
      note,
      location,
      count,
      COALESCE(activity_date, created_at) AS date,
      raw
    FROM activities
    WHERE COALESCE(activity_date, created_at) >= $1
      AND COALESCE(activity_date, created_at) < $2
    ORDER BY COALESCE(activity_date, created_at) ASC, created_at ASC
  `;

  const res = await pool.query(q, [startUtc.toISOString(), endUtc.toISOString()]);
  const rows = (res.rows || []).map(r => {
    let rawObj = null;
    try{
      if(r.raw && typeof r.raw === 'string') rawObj = JSON.parse(r.raw);
      else if(r.raw && typeof r.raw === 'object') rawObj = r.raw;
    }catch(e){ rawObj = null; }

    const activityType = rawObj && rawObj.activity_type ? String(rawObj.activity_type) : '';
    const highlights = rawObj && rawObj.highlights ? String(rawObj.highlights) : '';

    const rawMission = rawObj && rawObj.mission ? String(rawObj.mission).trim() : '';
    const noteText = String((rawObj && rawObj.note) ? rawObj.note : (r.note || '')).trim();

    return {
      id: r.id,
      title: r.title,
      note: noteText,
      location: r.location,
      count: r.count,
      date: r.date,
      activity_type: activityType,
      highlights,
      raw_mission: rawMission,
      raw_mission_lower: rawMission ? rawMission.toLowerCase() : ''
    };
  });

  const ins = `
    INSERT INTO recap_posts(
      mission, tz_offset_minutes, day_start_utc, day_end_utc, status, draft_html
    ) VALUES ($1,$2,$3,$4,'pending',$5)
    RETURNING id
  `;

  let createdCount = 0;
  for(const mission of missions){
    const filtered = rows.filter(r => missionMatchesRow(r, mission) && isDistributionActivity(r.activity_type));
    if(filtered.length === 0 && !RECAP_POST_EMPTY){
      console.log(`[recap-daily] No distribution activities found for mission=${mission} in ${dateLabel}. Skipping.`);
      continue;
    }

    const totalMushaf = filtered
      .map(r => parseCountToNumber(r.count))
      .filter(n => typeof n === 'number')
      .reduce((a,b) => a + b, 0);

    const locMap = new Map();
    for(const r of filtered){
      const name = simplifyPlaceName(r.location || '') || 'Unknown';
      locMap.set(name, (locMap.get(name) || 0) + 1);
    }
    const topLocations = Array.from(locMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a,b) => b.count - a.count);

    const bestHighlight = pickBestHighlight(filtered);

    const html = buildRecapHtml({
      mission,
      dateLabel,
      activities: filtered,
      totalMushaf,
      topLocations,
      bestHighlight
    });

    const insRes = await pool.query(ins, [mission, RECAP_TZ_OFFSET_MINUTES, startUtc.toISOString(), endUtc.toISOString(), html]);
    const recapId = insRes.rows && insRes.rows[0] ? String(insRes.rows[0].id) : '';
    if(!recapId) throw new Error('Failed to insert recap_posts row');

    createdCount++;
    console.log(`[recap-daily] Created pending recap id=${recapId} activities=${filtered.length} mushaf=${totalMushaf} mission=${mission} day=${dateLabel}`);

    const keyboard = {
      inline_keyboard: [[
        { text: 'Approve ✅', callback_data: `_recap_approve:${recapId}` },
        { text: 'Edit ✏️', callback_data: `_recap_edit:${recapId}` },
        { text: 'Cancel ❌', callback_data: `_recap_cancel:${recapId}` }
      ]]
    };

    const sent = await telegramApiRequest(TELEGRAM_BOT_TOKEN, 'sendMessage', {
      chat_id: RECAP_APPROVER_CHAT_ID,
      text: html,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: keyboard
    });

    try{
      const msg = sent && sent.result ? sent.result : null;
      const previewChatId = msg && msg.chat && (msg.chat.id != null) ? String(msg.chat.id) : String(RECAP_APPROVER_CHAT_ID);
      const previewMessageId = msg && msg.message_id != null ? Number(msg.message_id) : null;
      if(previewMessageId != null){
        await pool.query(
          'UPDATE recap_posts SET preview_chat_id = $2, preview_message_id = $3 WHERE id = $1',
          [recapId, previewChatId, previewMessageId]
        );
      }
    }catch(e){
      console.warn('[recap-daily] Failed to persist preview message metadata:', e && (e.message || e));
    }
  }

  if(createdCount === 0){
    console.log(`[recap-daily] No recaps created for ${dateLabel} (missions=${missions.join(', ')}).`);
  }

  await pool.end();
}

main().catch((e) => {
  console.error('[recap-daily] Failed:', e);
  process.exitCode = 1;
});
