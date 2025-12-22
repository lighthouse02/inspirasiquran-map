const { Pool } = require('pg');

// Netlify function to return activities from Neon Postgres.
// Netlify's Neon integration often provides NETLIFY_DATABASE_URL automatically.
// You can also set DATABASE_URL yourself; this function will accept either.

const connectionString = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;

if (!connectionString) {
  console.warn('Missing DATABASE_URL / NETLIFY_DATABASE_URL environment variable');
}

const pool = connectionString ? new Pool({ connectionString }) : null;

let _activitiesColsCache = null;
async function getActivitiesTableColumns(){
  if(_activitiesColsCache) return _activitiesColsCache;
  const res = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activities'"
  );
  _activitiesColsCache = new Set((res.rows || []).map(r => String(r.column_name || '').trim()).filter(Boolean));
  return _activitiesColsCache;
}

function parseCountNumberLoose(value){
  if(value == null) return null;
  if(typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  const t = String(value || '').trim();
  if(!t) return null;
  const m = t.match(/\d[\d,._\s]*/);
  if(!m) return null;
  const numStr = m[0].replace(/[^\d]/g, '');
  if(!numStr) return null;
  const n = Number(numStr);
  if(!Number.isFinite(n)) return null;
  return Math.round(n);
}

exports.handler = async function(event) {
  try {
    if (!pool) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Database is not configured. Set DATABASE_URL or NETLIFY_DATABASE_URL in Netlify environment variables.'
        })
      };
    }
    const cols = await getActivitiesTableColumns();
    const extra = [];
    if(cols.has('mission')) extra.push('mission');
    if(cols.has('activity_type')) extra.push('activity_type');
    if(cols.has('count_number')) extra.push('count_number');

    const q = `SELECT id, title, note, created_at, activity_date, count, ${extra.join(', ')}${extra.length ? ',' : ''} location, latitude AS lat, longitude AS lng, attachment_url, raw
               FROM activities
               ORDER BY COALESCE(activity_date, created_at) ASC, created_at ASC`;
    const res = await pool.query(q);
    const rows = res.rows.map(r => ({
      raw: r.raw,
      id: r.id,
      title: r.title,
      note: r.note,
      created_at: r.created_at,
      date: r.activity_date || r.created_at,
      count: r.count,
      count_number: r.count_number,
      mission: r.mission,
      activity_type: r.activity_type,
      location: r.location,
      lat: r.lat,
      lng: r.lng,
      attachment: r.attachment_url ? { webPath: r.attachment_url } : null
    }));

    // Extract optional fields (like highlights) from raw JSON if present.
    const normalized = rows.map(r => {
      let rawObj = null;
      try{
        if(r.raw && typeof r.raw === 'string') rawObj = JSON.parse(r.raw);
        else if(r.raw && typeof r.raw === 'object') rawObj = r.raw;
      }catch(e){ rawObj = null; }

      const highlights = rawObj && (rawObj.highlights || rawObj.highlight) ? String(rawObj.highlights || rawObj.highlight) : '';
      const activity_type = (r.activity_type != null && String(r.activity_type).trim())
        ? String(r.activity_type)
        : (rawObj && rawObj.activity_type ? String(rawObj.activity_type) : '');
      const mission = (r.mission != null && String(r.mission).trim())
        ? String(r.mission)
        : (rawObj && rawObj.mission ? String(rawObj.mission) : '');
      const count_number = (r.count_number != null)
        ? parseCountNumberLoose(r.count_number)
        : ((rawObj && rawObj.count_number != null)
          ? parseCountNumberLoose(rawObj.count_number)
          : parseCountNumberLoose(r.count));

      // Do not return raw by default (keeps payload small), only derived fields.
      const { raw, ...rest } = r;
      return {
        ...rest,
        activity_type,
        highlights: highlights || '',
        mission: mission || '',
        count_number: count_number == null ? null : count_number
      };
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalized)
    };
  } catch (err) {
    console.error('get-activities error', err);
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
  }
};
