const fs = require('fs');
const path = require('path');
const https = require('https');
const TelegramBot = require('node-telegram-bot-api');

let Pool = null;
try{
  ({ Pool } = require('pg'));
}catch(e){
  // optional dependency; bot can still run in file-backed mode
  Pool = null;
}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if(!TOKEN){
  console.error('Please set TELEGRAM_BOT_TOKEN environment variable');
  process.exit(1);
}

const ALLOWED = (process.env.ALLOWED_TELEGRAM_IDS || '').split(',').map(s=>s.trim()).filter(Boolean).map(Number);
// Optional: announce saved activities to a Telegram channel/chat.
// Set TELEGRAM_CHANNEL_ID (e.g. -1001234567890 or @yourchannelusername)
const ANNOUNCE_CHAT_ID = (process.env.TELEGRAM_CHANNEL_ID || process.env.TELEGRAM_ANNOUNCE_CHAT_ID || '').trim();
const bot = new TelegramBot(TOKEN, { polling: true });
const ACTIVITIES_PATH = path.resolve(__dirname, '..', 'activities.json');
const UPLOADS_DIR = path.resolve(__dirname, 'uploads');
if(!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Used for menu-driven edit/delete prompts (when user taps buttons instead of typing commands).
const pendingMenuActionByChatId = Object.create(null);

// Register commands so Telegram shows them in the bot UI menu.
try{
  bot.setMyCommands([
    { command: 'menu', description: 'Show buttons' },
    { command: 'new', description: 'Create a new activity (guided)' },
    { command: 'list', description: 'List recent activities' },
    { command: 'help', description: 'Show help' },
    { command: 'cancel', description: 'Cancel current session' },
    { command: 'edit', description: 'Edit an activity by id' },
    { command: 'delete', description: 'Delete an activity by id' }
  ]).catch(()=>{});
}catch(e){
  // ignore
}

function escapeHtml(s){
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildAnnouncementText(item, action){
  const title = item && item.title ? String(item.title) : 'Activity';
  const dateText = item && item.date ? formatDateUTC(item.date) : (item && item.dateRaw ? String(item.dateRaw) : '');
  const countText = (item && item.count != null && String(item.count).trim() !== '') ? String(item.count) : '';
  const locationText = item && item.location ? String(item.location) : '';
  const coordsText = (item && typeof item.lat === 'number' && typeof item.lng === 'number') ? `${item.lat.toFixed(5)}, ${item.lng.toFixed(5)}` : '';
  const noteText = item && item.note ? String(item.note) : '';
  const idText = (item && item.id != null && String(item.id).trim() !== '') ? String(item.id) : '';

  const lines = [];
  lines.push(`<b>${escapeHtml(action || 'Activity')}</b>`);
  lines.push(`<b>Title:</b> ${escapeHtml(title)}`);
  if(dateText) lines.push(`<b>Date:</b> ${escapeHtml(dateText)}`);
  if(countText) lines.push(`<b>Count:</b> ${escapeHtml(countText)}`);
  if(locationText) lines.push(`<b>Location:</b> ${escapeHtml(locationText)}`);
  if(coordsText) lines.push(`<b>Coords:</b> ${escapeHtml(coordsText)}`);
  if(noteText) lines.push(`<b>Note:</b> ${escapeHtml(noteText)}`);
  if(idText) lines.push(`<b>ID:</b> ${escapeHtml(idText)}`);
  return lines.join('\n');
}

function getAttachmentSendTarget(item){
  const a = item && item.attachment ? item.attachment : null;
  // Prefer Telegram file_id (best reliability)
  if(a && a.fileId) return { kind: a.type || 'photo', target: a.fileId };

  // Then local file path
  if(a && a.path && fs.existsSync(a.path)) return { kind: a.type || 'photo', target: fs.createReadStream(a.path) };

  // Then a public URL, if stored
  const url = (a && a.webPath && /^https?:\/\//i.test(String(a.webPath))) ? String(a.webPath) :
              (item && item.attachment_url && /^https?:\/\//i.test(String(item.attachment_url))) ? String(item.attachment_url) : '';
  if(url) return { kind: (a && a.type) ? String(a.type) : ((item && item.attachment_type) ? String(item.attachment_type) : 'photo'), target: url };

  return null;
}

async function announceToChannelIfConfigured(item, action){
  if(!ANNOUNCE_CHAT_ID) return;
  const text = buildAnnouncementText(item, action);
  const attachment = getAttachmentSendTarget(item);

  try{
    if(attachment){
      const kind = String(attachment.kind || 'photo');
      // Telegram caption is limited; keep it safe.
      const caption = text.length > 950 ? (text.slice(0, 947) + '…') : text;
      if(kind === 'doc' || kind === 'document'){
        await bot.sendDocument(ANNOUNCE_CHAT_ID, attachment.target, { caption, parse_mode: 'HTML' });
      } else {
        await bot.sendPhoto(ANNOUNCE_CHAT_ID, attachment.target, { caption, parse_mode: 'HTML' });
      }
      if(text.length > caption.length){
        await bot.sendMessage(ANNOUNCE_CHAT_ID, text, { parse_mode: 'HTML', disable_web_page_preview: true });
      }
      return;
    }

    await bot.sendMessage(ANNOUNCE_CHAT_ID, text, { parse_mode: 'HTML', disable_web_page_preview: true });
  }catch(e){
    console.warn('Channel announce failed (check TELEGRAM_CHANNEL_ID and bot permissions):', e && (e.response && e.response.body ? e.response.body : e.message || e));
  }
}

// --- Neon/Postgres support ---
const DB_URL = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL || '';
let _dbPool = null;

function dbEnabled(){
  return Boolean(DB_URL && Pool);
}

function getDbPool(){
  if(!dbEnabled()) return null;
  if(_dbPool) return _dbPool;
  _dbPool = new Pool({ connectionString: DB_URL });
  return _dbPool;
}

async function insertActivityToDb(item){
  const pool = getDbPool();
  if(!pool) throw new Error('DB is not configured');
  const sql = `INSERT INTO activities(
      title, note, activity_date, count, location, latitude, longitude, attachment_url, attachment_type, raw
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING id`;
  const vals = [
    item.title || 'Activity',
    item.note || null,
    item.date ? new Date(item.date).toISOString() : null,
    item.count == null ? null : String(item.count),
    item.location || null,
    (typeof item.lat === 'number') ? item.lat : null,
    (typeof item.lng === 'number') ? item.lng : null,
    // Only store an attachment URL if it is already a public URL (http/https).
    (item.attachment && item.attachment.webPath && /^https?:\/\//i.test(String(item.attachment.webPath))) ? String(item.attachment.webPath) : null,
    (item.attachment && item.attachment.type) ? String(item.attachment.type) : null,
    item ? JSON.stringify(item) : null
  ];
  const r = await pool.query(sql, vals);
  return r.rows && r.rows[0] ? r.rows[0].id : null;
}

async function listActivitiesFromDb(limit){
  const pool = getDbPool();
  if(!pool) throw new Error('DB is not configured');
  const l = Math.max(1, Math.min(Number(limit || 10), 50));
  const q = `SELECT id, title, COALESCE(activity_date, created_at) AS date, count, location
             FROM activities
             ORDER BY COALESCE(activity_date, created_at) DESC
             LIMIT $1`;
  const res = await pool.query(q, [l]);
  return res.rows || [];
}

async function getActivityFromDbById(id){
  const pool = getDbPool();
  if(!pool) throw new Error('DB is not configured');
  const q = `SELECT id,
                    title,
                    note,
                    COALESCE(activity_date, created_at) AS date,
                    count,
                    location,
                    latitude AS lat,
                    longitude AS lng,
                    attachment_url,
                    attachment_type
             FROM activities
             WHERE id = $1`;
  const r = await pool.query(q, [id]);
  return (r.rows && r.rows[0]) ? r.rows[0] : null;
}

async function updateActivityInDb(id, item){
  const pool = getDbPool();
  if(!pool) throw new Error('DB is not configured');
  const sql = `UPDATE activities SET
      title = $2,
      note = $3,
      activity_date = $4,
      count = $5,
      location = $6,
      latitude = $7,
      longitude = $8,
      attachment_url = $9,
      attachment_type = $10,
      raw = $11
    WHERE id = $1
    RETURNING id`;
  const vals = [
    id,
    item.title || 'Activity',
    item.note || null,
    item.date ? new Date(item.date).toISOString() : null,
    item.count == null ? null : String(item.count),
    item.location || null,
    (typeof item.lat === 'number') ? item.lat : null,
    (typeof item.lng === 'number') ? item.lng : null,
    (item.attachment && item.attachment.webPath && /^https?:\/\//i.test(String(item.attachment.webPath))) ? String(item.attachment.webPath) : (item.attachment_url || null),
    (item.attachment && item.attachment.type) ? String(item.attachment.type) : (item.attachment_type || null),
    item ? JSON.stringify(item) : null
  ];
  const r = await pool.query(sql, vals);
  return r.rows && r.rows[0] ? r.rows[0].id : null;
}

async function deleteActivityFromDb(id){
  const pool = getDbPool();
  if(!pool) throw new Error('DB is not configured');
  const r = await pool.query('DELETE FROM activities WHERE id = $1 RETURNING id', [id]);
  return r.rows && r.rows[0] ? r.rows[0].id : null;
}

function loadActivities(){
  try{ return JSON.parse(fs.readFileSync(ACTIVITIES_PATH, 'utf8')); }catch(e){ return []; }
}
function saveActivities(arr){ fs.writeFileSync(ACTIVITIES_PATH, JSON.stringify(arr, null, 2), 'utf8'); }
function isAllowed(userId){ if(ALLOWED.length===0) return true; return ALLOWED.includes(userId); }

function getHelpText(){
  return `/menu - show buttons\n/new - guided input\n/back - go to previous step (during /new or /edit)\n/skip - skip current step\n/edit <id> - edit an existing activity\n/delete <id> - delete an activity\n/add title | ISO-date | count | location | lat lng | note - quick add\n/list - recent (shows IDs)\n/cancel - cancel guided input\n
During /new you can share location via Telegram or type a location (e.g. Kuala Lumpur, Malaysia), and attach a photo or document. Date examples: now, 2025-12-20, 2025-12-20 14:30, Dec 20 2025.`;
}

async function sendRecentList(chatId){
  try{
    if(dbEnabled()){
      const rows = await listActivitiesFromDb(10);
      const lines = rows.map(r=>{
        const sid = String(r.id || '').slice(0, 8);
        return `${sid} — ${new Date(r.date).toISOString()} — ${r.title} ${r.count?('('+r.count+')'):''} ${r.location||''}`;
      });
      return bot.sendMessage(chatId, lines.join('\n') || 'No activities');
    }
    const arr = loadActivities();
    const lines = arr.slice(-10).reverse().map(i=>`${String(i.id||'').slice(0,8)} — ${i.date} — ${i.title} ${i.count?('('+i.count+')'):''} ${i.location||''}`);
    return bot.sendMessage(chatId, lines.join('\n') || 'No activities');
  }catch(e){
    console.error('List failed', e);
    return bot.sendMessage(chatId, 'List failed: ' + (e.message || e));
  }
}

async function sendMainMenu(chatId){
  const keyboard = {
    inline_keyboard: [
      [{ text: '➕ New activity', callback_data: '_menu_new' }, { text: '📋 List', callback_data: '_menu_list' }],
      [{ text: '✏️ Edit', callback_data: '_menu_edit' }, { text: '🗑️ Delete', callback_data: '_menu_delete' }],
      [{ text: 'ℹ️ Help', callback_data: '_menu_help' }],
      [{ text: '✖️ Cancel', callback_data: '_menu_cancel' }]
    ]
  };
  return bot.sendMessage(chatId, 'Activity bot menu:', { reply_markup: keyboard });
}

async function handleDeleteById(chatId, userId, id){
  if(!isAllowed(userId)) return bot.sendMessage(chatId, 'Not authorized');
  if(sessions[chatId]) return bot.sendMessage(chatId, 'You are in a session. Type /cancel first.');
  const normalizedId = normalizeText(id);
  if(!normalizedId) return bot.sendMessage(chatId, 'Usage: delete needs an id (get the id from /list)');
  try{
    if(dbEnabled()){
      const deleted = await deleteActivityFromDb(normalizedId);
      if(!deleted) return bot.sendMessage(chatId, 'Not found: ' + normalizedId);
      return bot.sendMessage(chatId, 'Deleted: ' + deleted + ' (Neon)');
    }
    const arr = loadActivities();
    const before = arr.length;
    const next = arr.filter(a => String(a.id) !== normalizedId);
    if(next.length === before) return bot.sendMessage(chatId, 'Not found: ' + normalizedId);
    saveActivities(next);
    return bot.sendMessage(chatId, 'Deleted: ' + normalizedId + ' (local file)');
  }catch(e){
    console.error('Delete failed', e);
    return bot.sendMessage(chatId, 'Delete failed: ' + (e.message || e));
  }
}

function makeId(){ return 'a-' + Math.random().toString(36).slice(2,10); }
function safeDateISO(s){ const d = new Date(s); return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(); }
// try to parse flexible user date inputs into an ISO string; return empty string if unknown
function parseFlexibleDate(s){
  if(!s) return '';
  const t = String(s).trim().toLowerCase();
  if(t === 'now' || t === 'current' || t === 'current time' || t === 'today' || t === 'today now'){
    return new Date().toISOString();
  }
  // direct parse
  let d = new Date(s);
  if(!isNaN(d.getTime())) return d.toISOString();
  // try replace space with T and assume local time
  try{
    d = new Date(s.replace(' ', 'T'));
    if(!isNaN(d.getTime())) return d.toISOString();
  }catch(e){}
  // try yyyy-mm-dd hh:mm
  const m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if(m){
    const Y = Number(m[1]), Mo = Number(m[2])-1, D = Number(m[3]);
    const hh = m[4]?Number(m[4]):0, mm = m[5]?Number(m[5]):0;
    d = new Date(Date.UTC(Y,Mo,D,hh,mm));
    if(!isNaN(d.getTime())) return d.toISOString();
  }
  return '';
}

// Format an ISO date (or any date parseable by Date) into a localized human string
function formatDateLocalized(isoOrDate){
  if(!isoOrDate) return '';
  const d = new Date(isoOrDate);
  if(isNaN(d.getTime())) return String(isoOrDate);
  try{
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }catch(e){
    return d.toString();
  }
}

// Format a date in UTC as a readable string (e.g. "20 Dec 2025, 14:30 UTC")
function formatDateUTC(isoOrDate){
  if(!isoOrDate) return '';
  const d = new Date(isoOrDate);
  if(isNaN(d.getTime())) return String(isoOrDate);
  try{
    const parts = d.toUTCString().split(' '); // e.g. [Weekday,, DD, Mon, YYYY, HH:MM:SS, GMT]
    // Use Intl for nice formatting in UTC
    return d.toLocaleString('en-GB', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' UTC';
  }catch(e){
    return d.toUTCString();
  }
}

// geocode a freeform location using Nominatim (OpenStreetMap)
function geocodeLocation(query){
  return new Promise((resolve)=>{
    if(!query) return resolve(null);
    const q = encodeURIComponent(query);
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}`;
    https.get(url, { headers: { 'User-Agent': 'inspirasiquran-map-bot/1.0' } }, (res)=>{
      let body=''; res.on('data', c=>body+=c); res.on('end', ()=>{
        try{ const js = JSON.parse(body); if(js && js.length){ const r = js[0]; return resolve({ lat: Number(r.lat), lng: Number(r.lon), display_name: r.display_name }); } }catch(e){}
        resolve(null);
      });
    }).on('error', ()=> resolve(null));
  });
}

const sessions = {};
function startSession(chatId, userId, mode){ sessions[chatId] = { userId, mode: mode || 'create', step:'title', data:{} }; }
function endSession(chatId){ delete sessions[chatId]; }

function normalizeText(s){
  return String(s || '').trim();
}

function isSkipText(text){
  const t = normalizeText(text).toLowerCase();
  if(!t) return false;
  // Support "/skip", "/skip@botname", and plain "skip".
  return t === 'skip' || t === '/skip' || t.startsWith('/skip@');
}

function parseCountInput(raw){
  const t = normalizeText(raw);
  if(!t || isSkipText(t)) return null;
  // Treat 0 as "unknown" (null)
  if(/^0+$/.test(t.replace(/[\s,._-]/g,''))) return null;

  // If it contains digits, try to parse a numeric count even with separators.
  // Examples: "1200", "1,200", "1 200", "8000 mushaf" => 1200/8000
  const digitMatch = t.match(/\d[\d,._\s]*/);
  if(digitMatch){
    const numStr = digitMatch[0].replace(/[^\d.]/g, '');
    const n = Number(numStr);
    if(!Number.isNaN(n) && Number.isFinite(n)){
      // If the remainder is only a unit like "mushaf", keep it numeric (UI adds unit).
      const remainder = t.replace(digitMatch[0], '').trim().toLowerCase();
      if(!remainder || remainder === 'mushaf' || remainder === 'mushafs') return n;
      // Otherwise preserve the original text (it may contain meaningful qualifiers).
      return t;
    }
  }

  // Fallback: keep text as-is.
  return t;
}

async function sendPreview(chatId, s){
  const item = {
    id: s.data.id || makeId(),
    title: s.data.title,
    date: safeDateISO(s.data.date),
    count: s.data.count,
    location: s.data.location,
    lat: s.data.lat,
    lng: s.data.lng,
    note: s.data.note,
    attachment: s.data.attachment||null
  };

  s.pending = item;
  s.step = 'confirming';

  const displayDate = item.date ? formatDateUTC(item.date) : (item.dateRaw || '');
  let preview = `*Preview activity*\n\n*Title:* ${escapeMarkdown(item.title)}\n*Date:* ${escapeMarkdown(displayDate)}\n*Count:* ${escapeMarkdown(String(item.count||''))}\n*Location:* ${escapeMarkdown(String(item.location||''))}`;
  if(item.lat && item.lng) preview += `\n*Coords:* ${item.lat}, ${item.lng}`;
  if(item.note) preview += `\n\n*Note:* ${escapeMarkdown(item.note)}`;
  if(item.attachment && item.attachment.type) preview += `\n\n_Attachment:_ ${escapeMarkdown(item.attachment.type)}`;

  const keyboard = { inline_keyboard: [[{ text: 'Confirm ✅', callback_data: '_confirm' }, { text: 'Cancel ❌', callback_data: '_cancel' }]] };
  try{
    if(item.attachment && item.attachment.type === 'photo' && item.attachment.path && fs.existsSync(item.attachment.path)){
      item.attachment.webPath = path.join('telegram-bot','uploads', path.basename(item.attachment.path));
      await bot.sendPhoto(chatId, item.attachment.path, { caption: preview, parse_mode: 'Markdown', reply_markup: keyboard });
    } else {
      if(item.attachment && item.attachment.path){ item.attachment.webPath = path.join('telegram-bot','uploads', path.basename(item.attachment.path)); }
      await bot.sendMessage(chatId, preview, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
  }catch(e){
    console.warn('Preview send failed, falling back to text', e);
    await bot.sendMessage(chatId, preview, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

async function handleSkip(chatId, s){
  if(!s) return;
  if(s.step === 'date'){
    s.data.date = safeDateISO('');
    s.step = 'count';
    return bot.sendMessage(chatId, 'Count (number) or text — e.g. 1200 or "1,200 Mushaf". If unknown, type 0 or /skip', { reply_markup:{ force_reply:true } });
  }
  if(s.step === 'count'){
    s.data.count = null;
    s.step = 'location';
    const opts = { reply_markup:{ keyboard:[[{ text:'Send my location', request_location:true }],[{ text:'Type location' }]], one_time_keyboard:true } };
    return bot.sendMessage(chatId, 'Please share location or type a location name', opts);
  }
  if(s.step === 'location'){
    s.data.location = s.data.location || '';
    s.step = 'attachment';
    return bot.sendMessage(chatId, 'Skipping location. Attach a photo/doc or type /skip', { reply_markup:{ remove_keyboard:true } });
  }
  if(s.step === 'attachment'){
    s.data.attachment = null;
    s.step = 'note';
    return bot.sendMessage(chatId, 'Skipping attachment. Any note? (or /skip)', { reply_markup:{ force_reply:true } });
  }
  if(s.step === 'note'){
    s.data.note = '';
    return sendPreview(chatId, s);
  }
}

function downloadFile(fileId, destPath){
  return bot.getFileLink(fileId).then(url => new Promise((resolve,reject)=>{
    const file = fs.createWriteStream(destPath);
    https.get(url, (res)=>{ res.pipe(file); file.on('finish', ()=>file.close(()=>resolve(destPath))); }).on('error', (err)=>{ fs.unlink(destPath, ()=>{}); reject(err); });
  }));
}

function escapeMarkdown(text){
  if(!text) return '';
  return String(text).replace(/([_*\[\]()`~>#+-=|{}.!])/g,'\\$1');
}

function beginGuidedFlow(msg){
  const chatId = msg.chat.id;
  if(!isAllowed(msg.from.id)) return bot.sendMessage(chatId, 'You are not authorized to use guided input.');
  startSession(chatId, msg.from.id, 'create');
  bot.sendMessage(chatId, "Let's create a new activity. What is the title? (e.g. 'Quran distribution — Village X')", { reply_markup:{ force_reply:true } });
}

function stepPrev(step){
  const map = {
    confirming: 'note',
    note: 'attachment',
    attachment: 'location',
    location: 'count',
    count: 'date',
    date: 'title'
  };
  return map[step] || '';
}

async function promptForStep(chatId, s){
  const mode = s.mode || 'create';
  if(s.step === 'title'){
    const cur = mode === 'edit' ? (s.data.title || '') : '';
    const msg = mode === 'edit'
      ? `Editing activity. Current title: ${cur ? '"' + cur + '"' : '(empty)'}\nSend new title (or /skip to keep).`
      : "Let's create a new activity. What is the title? (e.g. 'Quran distribution — Village X')";
    return bot.sendMessage(chatId, msg, { reply_markup:{ force_reply:true } });
  }
  if(s.step === 'date'){
    const cur = s.data.date ? formatDateUTC(s.data.date) : (s.data.dateRaw || '');
    const msg = mode === 'edit'
      ? `Current date: ${cur || '(empty)'}\nSend new date/time (or /skip to keep).`
      : 'Date/time (examples: now, 2025-12-20, 2025-12-20 14:30, Dec 20 2025). Tip: type "now" for current time.';
    return bot.sendMessage(chatId, msg, { reply_markup:{ force_reply:true } });
  }
  if(s.step === 'count'){
    const cur = (s.data.count == null) ? '' : String(s.data.count);
    const msg = mode === 'edit'
      ? `Current count: ${cur || '(empty)'}\nSend new count (e.g. 1200 or "1,200 Mushaf"), or /skip to keep.`
      : 'Count (number) or text — e.g. 1200 or "1,200 Mushaf". If unknown, type 0 or /skip';
    return bot.sendMessage(chatId, msg, { reply_markup:{ force_reply:true } });
  }
  if(s.step === 'location'){
    const cur = s.data.location || '';
    const msg = mode === 'edit'
      ? `Current location: ${cur || '(empty)'}\nShare Telegram location or type a new location, or /skip to keep.`
      : 'Please share location or type a location name';
    const opts = { reply_markup:{ keyboard:[[{ text:'Send my location', request_location:true }],[{ text:'Type location' }]], one_time_keyboard:true } };
    return bot.sendMessage(chatId, msg, opts);
  }
  if(s.step === 'attachment'){
    const has = Boolean(s.data.attachment);
    const msg = (mode === 'edit')
      ? `Attachment: ${has ? 'currently set' : 'none'}. Send a new photo/doc to replace, or /skip to keep.`
      : 'Attach a photo/doc or type /skip';
    return bot.sendMessage(chatId, msg, { reply_markup:{ remove_keyboard:true } });
  }
  if(s.step === 'note'){
    const cur = s.data.note || '';
    const msg = (mode === 'edit')
      ? `Current note: ${cur ? '"' + cur + '"' : '(empty)'}\nSend new note (or /skip to keep).`
      : 'Any note? (or /skip)';
    return bot.sendMessage(chatId, msg, { reply_markup:{ force_reply:true } });
  }
}

async function beginEditFlow(msg, id){
  const chatId = msg.chat.id;
  if(!isAllowed(msg.from.id)) return bot.sendMessage(chatId, 'Not authorized');
  if(sessions[chatId]) return bot.sendMessage(chatId, 'You are already in a session. Type /cancel to stop it first.');
  const activityId = normalizeText(id);
  if(!activityId) return bot.sendMessage(chatId, 'Usage: /edit <id> (get the id from /list)');

  try{
    let existing = null;
    if(dbEnabled()){
      existing = await getActivityFromDbById(activityId);
    } else {
      const arr = loadActivities();
      existing = arr.find(a => String(a.id) === activityId) || null;
    }
    if(!existing) return bot.sendMessage(chatId, 'Not found: ' + activityId);

    startSession(chatId, msg.from.id, 'edit');
    const s = sessions[chatId];
    // seed session data with existing values so /skip keeps them
    s.data.id = existing.id;
    s.data.title = existing.title || '';
    s.data.note = existing.note || existing.desc || '';
    s.data.date = existing.date ? safeDateISO(existing.date) : (existing.activity_date ? safeDateISO(existing.activity_date) : safeDateISO(''));
    s.data.count = (existing.count == null) ? null : existing.count;
    s.data.location = existing.location || '';
    s.data.lat = (typeof existing.lat === 'number') ? existing.lat : (existing.latitude || null);
    s.data.lng = (typeof existing.lng === 'number') ? existing.lng : (existing.longitude || null);
    // keep attachment if present (DB returns attachment_url/type)
    if(existing.attachment_url || existing.attachment_type){
      s.data.attachment = { type: existing.attachment_type || 'photo', webPath: existing.attachment_url || '' };
    } else if(existing.attachment){
      s.data.attachment = existing.attachment;
    }
    s.step = 'title';
    return promptForStep(chatId, s);
  }catch(e){
    console.error('edit flow begin failed', e);
    return bot.sendMessage(chatId, 'Edit failed: ' + (e.message || e));
  }
}

bot.onText(/\/start/, (msg)=> sendMainMenu(msg.chat.id));
bot.onText(/\/menu/, (msg)=> sendMainMenu(msg.chat.id));
bot.onText(/\/help/, (msg)=> bot.sendMessage(msg.chat.id, getHelpText()));

bot.onText(/\/new/, (msg)=> beginGuidedFlow(msg));
bot.onText(/\/cancel/, (msg)=>{ pendingMenuActionByChatId[msg.chat.id] = null; endSession(msg.chat.id); bot.sendMessage(msg.chat.id, 'Canceled.'); });

// Allow skipping steps in the guided flow from any step.
bot.onText(/\/skip(?:@\w+)?/i, (msg)=>{
  const chatId = msg.chat.id;
  const s = sessions[chatId];
  if(!s) return;
  handleSkip(chatId, s).catch(()=>{});
});

bot.onText(/\/back(?:@\w+)?/i, (msg)=>{
  const chatId = msg.chat.id;
  const s = sessions[chatId];
  if(!s) return;
  const prev = stepPrev(s.step);
  if(!prev) return bot.sendMessage(chatId, 'Already at the first step.');
  s.step = prev;
  promptForStep(chatId, s).catch(()=>{});
});

bot.onText(/\/edit\s+([\s\S]+)/i, (msg, match)=>{
  return beginEditFlow(msg, match && match[1]);
});

bot.onText(/\/delete\s+([\s\S]+)/i, (msg, match)=>{
  const chatId = msg.chat.id;
  return handleDeleteById(chatId, msg.from.id, match && match[1]);
});

bot.onText(/\/add(\s+[\s\S]+)/i, (msg, match)=>{
  if(!isAllowed(msg.from.id)) return bot.sendMessage(msg.chat.id, 'Not authorized');
  (async function(){
    try{
      const parts = match[1].trim().split('|').map(s=>s.trim());
      const [title, dateStr, countStr, location, latlng, note] = parts;
      const item = { id: makeId(), title: title||'Activity', date: safeDateISO(dateStr||''), count: countStr? (isNaN(Number(countStr))?countStr:Number(countStr)) : null, location: location||'', note: note||'' };
      if(latlng){ const m = latlng.split(/[ ,;]+/).map(Number); if(m.length>=2) { item.lat = m[0]; item.lng = m[1]; } }

      if(dbEnabled()){
        await insertActivityToDb(item);
      } else {
        const arr = loadActivities(); arr.push(item); arr.sort((a,b)=> new Date(a.date)-new Date(b.date)); saveActivities(arr);
      }

      bot.sendMessage(msg.chat.id, 'Added: ' + item.title);
    }catch(e){
      console.error('Add failed', e);
      bot.sendMessage(msg.chat.id, 'Add failed: ' + (e.message || e));
    }
  })();
});

bot.onText(/\/list/, (msg)=>{ sendRecentList(msg.chat.id).catch(()=>{}); });

bot.on('message', async (msg)=>{
  const chatId = msg.chat.id;
  if(msg.edit_date) return;

  // Handle menu-driven prompts even when not in a guided session.
  const pendingMenuAction = pendingMenuActionByChatId[chatId];
  if(!sessions[chatId] && pendingMenuAction){
    // Avoid intercepting normal commands.
    if(msg.text && /^\/(start|help|menu|new|cancel|skip|back|edit|delete|add|list)\b/i.test(msg.text)) return;

    const raw = normalizeText(msg.text);
    pendingMenuActionByChatId[chatId] = null;
    if(!raw) return bot.sendMessage(chatId, 'Please send the activity ID (you can get it from /list).');

    if(pendingMenuAction === 'edit'){
      return beginEditFlow({ chat: { id: chatId }, from: { id: msg.from.id } }, raw);
    }
    if(pendingMenuAction === 'delete'){
      return handleDeleteById(chatId, msg.from.id, raw);
    }
    return;
  }

  const s = sessions[chatId];
  if(!s) return;
  try{
    // Commands are handled by onText handlers; avoid double-processing in the step machine.
    if(msg.text && /^\/(start|help|new|cancel|skip|back|edit|delete|add|list)\b/i.test(msg.text)) return;

    if(s.step==='title'){
      if(isSkipText(msg.text) && s.mode === 'edit'){
        // keep current
      } else {
        s.data.title = msg.text || msg.caption || s.data.title || 'Untitled';
      }
      s.step = 'date';
      return promptForStep(chatId, s);
    }
    if(s.step==='date'){
      const raw = (msg.text||'').trim();
      if(isSkipText(raw)){
        if(s.mode !== 'edit') s.data.date = safeDateISO('');
        s.step = 'count';
        return promptForStep(chatId, s);
      }
      // Telegram doesn't really let you send an empty message; but if we ever get blank text,
      // treat it as "now" (current time) so the flow can continue.
      if(!raw){
        s.data.date = safeDateISO('');
        s.step = 'count';
        return promptForStep(chatId, s);
      }
      const parsed = parseFlexibleDate(raw);
      if(parsed){
        s.data.date = parsed;
      } else {
        s.data.date = safeDateISO(raw);
        s.data.dateRaw = raw; // preserve original when parsing is uncertain
      }
      s.step = 'count';
      return promptForStep(chatId, s);
    }
    if(s.step==='count'){
      if(isSkipText(msg.text)){
        // keep existing when editing, else clear
        if(s.mode !== 'edit') s.data.count = null;
      } else {
        s.data.count = parseCountInput(msg.text);
      }
      s.step='location';
      return promptForStep(chatId, s);
    }
    if(s.step==='location'){
      if(isSkipText(msg.text)){
        // keep existing when editing; otherwise blank
        if(s.mode !== 'edit') s.data.location = '';
        s.step = 'attachment';
        return promptForStep(chatId, s);
      }
      if(msg.location){ s.data.lat = msg.location.latitude; s.data.lng = msg.location.longitude; s.data.location = 'Shared location'; s.step='attachment'; return bot.sendMessage(chatId, 'Location set from your shared location. Attach a photo/doc or type /skip', { reply_markup:{ remove_keyboard:true } }); }
      if(msg.text && msg.text!=='Send my location' && msg.text!=='Type location'){
        const typed = msg.text.trim(); // try to geocode
        const geo = await geocodeLocation(typed);
        if(geo){ s.data.lat = geo.lat; s.data.lng = geo.lng; s.data.location = geo.display_name; s.step='attachment'; return bot.sendMessage(chatId, `Location resolved: ${geo.display_name} (${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)})\nAttach photo/doc or type /skip`); }
        // fallback: store text only but warn user
        s.data.location = typed; s.step='attachment'; return bot.sendMessage(chatId, 'Location saved as text (could not geocode). Example formats: "Kuala Lumpur, Malaysia" or "Bukit Bintang, Kuala Lumpur". You can send a Telegram location instead to set coords, or continue and attach photo/doc. Type /skip to continue.');
      }
      return bot.sendMessage(chatId, 'Tap Send my location or type location name');
    }
    if(s.step==='attachment'){
      // If user sends text like "skip" or "/skip@bot" treat it as skip.
      if(msg.photo && msg.photo.length){ const fileId = msg.photo[msg.photo.length-1].file_id; const filename = path.join(UPLOADS_DIR, fileId + '.jpg'); try{ await downloadFile(fileId, filename); s.data.attachment={type:'photo',path:filename,fileId}; }catch(e){ s.data.attachment={type:'photo',fileId}; } s.step='note'; return bot.sendMessage(chatId, 'Photo saved. Add an optional note (or type /skip). Tip: use full-resolution images for best results.'); }
      if(msg.document){ const fileId=msg.document.file_id; const filename = path.join(UPLOADS_DIR, msg.document.file_name||fileId); try{ await downloadFile(fileId, filename); s.data.attachment={type:'doc',path:filename,fileId}; }catch(e){ s.data.attachment={type:'doc',fileId}; } s.step='note'; return bot.sendMessage(chatId, 'Document saved. Any note? (or /skip)'); }
      if(msg.text && isSkipText(msg.text)){
        // keep existing when editing; otherwise clear
        if(s.mode !== 'edit') s.data.attachment = null;
        s.step='note';
        return bot.sendMessage(chatId, 'Skipping attachment. Any note? (or /skip)', { reply_markup:{ force_reply:true } });
      }
      return bot.sendMessage(chatId, 'Send a photo/document or type /skip');
    }
    if(s.step==='note'){
      // Accept plain "skip" and "/skip@bot". Also accept captions if user sends a photo/doc here.
      if(msg.text && isSkipText(msg.text)){
        if(s.mode !== 'edit') s.data.note='';
      } else if(typeof msg.text === 'string'){
        s.data.note = msg.text;
      } else if(typeof msg.caption === 'string'){
        s.data.note = msg.caption;
      } else {
        s.data.note = s.data.note || '';
      }
      return sendPreview(chatId, s);
    }
  }catch(e){ console.error('session error', e); bot.sendMessage(chatId, 'Error occurred, session canceled'); endSession(chatId); }
});

console.log('Telegram guided bot ready. Run with TELEGRAM_BOT_TOKEN env var set.');

// handle inline confirm/cancel callbacks
bot.on('callback_query', async (cq) => {
  try{
    const data = cq.data;
    const chatId = cq.message.chat.id;

    // Menu actions should work even when there is no active session.
    if(data === '_menu_new'){
      await bot.answerCallbackQuery(cq.id, { text: 'New activity' });
      return beginGuidedFlow({ chat: { id: chatId }, from: { id: cq.from.id } });
    }
    if(data === '_menu_list'){
      await bot.answerCallbackQuery(cq.id, { text: 'Listing…' });
      await sendRecentList(chatId);
      return;
    }
    if(data === '_menu_help'){
      await bot.answerCallbackQuery(cq.id, { text: 'Help' });
      await bot.sendMessage(chatId, getHelpText());
      return;
    }
    if(data === '_menu_edit'){
      pendingMenuActionByChatId[chatId] = 'edit';
      await bot.answerCallbackQuery(cq.id, { text: 'Edit' });
      await bot.sendMessage(chatId, 'Send the activity ID to edit (get it from /list).', { reply_markup:{ force_reply:true } });
      return;
    }
    if(data === '_menu_delete'){
      pendingMenuActionByChatId[chatId] = 'delete';
      await bot.answerCallbackQuery(cq.id, { text: 'Delete' });
      await bot.sendMessage(chatId, 'Send the activity ID to delete (get it from /list).', { reply_markup:{ force_reply:true } });
      return;
    }
    if(data === '_menu_cancel'){
      await bot.answerCallbackQuery(cq.id, { text: 'Canceled' });
      pendingMenuActionByChatId[chatId] = null;
      endSession(chatId);
      await bot.sendMessage(chatId, 'Canceled.');
      return;
    }

    const session = sessions[chatId];
    if(!session){
      await bot.answerCallbackQuery(cq.id, { text: 'Session expired.' });
      return;
    }
    if(data === '_confirm'){
      const item = session.pending;
      if(!item){ await bot.answerCallbackQuery(cq.id, { text: 'Nothing to confirm.' }); return; }
      // ensure attachment has webPath for client rendering
      try{ if(item.attachment && item.attachment.path && !item.attachment.webPath){ item.attachment.webPath = path.join('telegram-bot','uploads', path.basename(item.attachment.path)); } }catch(e){}

      // Save to Neon DB if configured; otherwise save to local activities.json
      if(dbEnabled()){
        if((session.mode || 'create') === 'edit'){
          await updateActivityInDb(item.id, item);
        } else {
          const newId = await insertActivityToDb(item);
          if(newId != null) item.id = newId;
        }
      } else {
        const arr = loadActivities();
        if((session.mode || 'create') === 'edit'){
          const idx = arr.findIndex(a => String(a.id) === String(item.id));
          if(idx >= 0) arr[idx] = item; else arr.push(item);
        } else {
          arr.push(item);
        }
        arr.sort((a,b)=> new Date(a.date)-new Date(b.date));
        saveActivities(arr);
      }

      await bot.editMessageReplyMarkup({}, { chat_id: chatId, message_id: cq.message.message_id });

      // Optional: announce to a channel/chat
      if((session.mode || 'create') === 'edit'){
        await announceToChannelIfConfigured(item, 'Activity updated');
      } else {
        await announceToChannelIfConfigured(item, 'New activity');
      }

      const savedDateText = item.date ? formatDateUTC(item.date) : (item.dateRaw || item.date || '');
      await bot.sendMessage(chatId, ((session.mode || 'create') === 'edit' ? 'Activity updated: ' : 'Activity saved: ') + item.title + ' — ' + savedDateText + (dbEnabled() ? ' (Neon)' : ' (local file)'));
      await bot.answerCallbackQuery(cq.id, { text: 'Saved' });
      endSession(chatId);
      return;
    }
    if(data === '_cancel'){
      await bot.editMessageReplyMarkup({}, { chat_id: chatId, message_id: cq.message.message_id });
      await bot.sendMessage(chatId, 'Activity creation canceled.');
      await bot.answerCallbackQuery(cq.id, { text: 'Canceled' });
      endSession(chatId);
      return;
    }
    await bot.answerCallbackQuery(cq.id, { text: 'Unknown action' });
  }catch(e){ console.error('callback_query error', e); }
});
