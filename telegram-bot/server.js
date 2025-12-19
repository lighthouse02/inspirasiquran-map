const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if(!TOKEN){
  console.error('Please set TELEGRAM_BOT_TOKEN environment variable');
  process.exit(1);
}

// Optional: comma-separated list of allowed Telegram user IDs (for security)
const ALLOWED = (process.env.ALLOWED_TELEGRAM_IDS || '').split(',').map(s=>s.trim()).filter(Boolean).map(Number);

const bot = new TelegramBot(TOKEN, { polling: true });
const ACTIVITIES_PATH = path.resolve(__dirname, '..', 'activities.json');

function loadActivities(){
  try{
    const txt = fs.readFileSync(ACTIVITIES_PATH, 'utf8');
    return JSON.parse(txt);
  }catch(e){
    console.warn('Could not read activities.json, starting with empty array');
    return [];
  }
}

function saveActivities(arr){
  fs.writeFileSync(ACTIVITIES_PATH, JSON.stringify(arr, null, 2), 'utf8');
}

function isAllowed(userId){
  if(ALLOWED.length === 0) return true; // open by default
  return ALLOWED.includes(userId);
}

function makeId(){ return 'a-' + Math.random().toString(36).slice(2,10); }

function parseAddCommand(text){
  // expected format: /add title | 2025-12-19T07:30:00Z | 8000 | Location | lat|lng | note
  const parts = text.replace(/^\/add\s*/i,'').split('|').map(s=>s.trim());
  const [title, dateStr, countStr, location, latlng, note] = parts;
  const item = { id: makeId(), title: title || 'Activity', date: dateStr || new Date().toISOString() };
  if(countStr) item.count = /^\\d+\b$/.test(countStr) ? parseInt(countStr,10) : countStr;
  if(location) item.location = location;
  if(latlng){
    const m = latlng.split(/[ ,;]+/).map(Number);
    if(m.length>=2 && !isNaN(m[0]) && !isNaN(m[1])){ item.lat = m[0]; item.lng = m[1]; }
  }
  if(note) item.note = note;
  return item;
}

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Activity bot ready. Use /help for commands');
});

bot.onText(/\/help/, (msg) => {
  const help = `Commands:
/add title | ISO-date | count | location | lat lng | note\n  Example: /add Distribution start | 2025-12-26T00:00:00Z | 8000 | Ouagadougou, Burkina Faso | 12.3714277 -1.5196603 | Arrived at airport\n
You can restrict who can post by setting ALLOWED_TELEGRAM_IDS env var to comma-separated Telegram user IDs.`;
  bot.sendMessage(msg.chat.id, help);
});

bot.onText(/\/add(\s+[\s\S]+)/i, (msg, match) => {
  const userId = msg.from && msg.from.id;
  if(!isAllowed(userId)){
    bot.sendMessage(msg.chat.id, 'You are not authorized to post activities.');
    return;
  }
  try{
    const item = parseAddCommand(match[0]);
    const arr = loadActivities();
    arr.push(item);
    // sort ascending by date
    arr.sort((a,b)=> new Date(a.date) - new Date(b.date));
    saveActivities(arr);
    bot.sendMessage(msg.chat.id, 'Activity added: ' + (item.title || item.id));
  }catch(e){
    console.error('Add failed', e);
    bot.sendMessage(msg.chat.id, 'Failed to add activity: ' + (e.message || e));
  }
});

bot.onText(/\/list/, (msg) => {
  const arr = loadActivities();
  const lines = arr.slice(-10).reverse().map(i=>`${i.date} — ${i.title} ${i.count?('('+i.count+')'):''} ${i.location||''}`);
  bot.sendMessage(msg.chat.id, lines.join('\n') || 'No activities');
});

bot.on('message', (msg) => {
  // ignore messages that are handled above
});

console.log('Telegram activity bot started. Editing', ACTIVITIES_PATH);
