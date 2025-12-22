const { Pool } = require('pg');

// Netlify function to return activities from Neon Postgres.
// Netlify's Neon integration often provides NETLIFY_DATABASE_URL automatically.
// You can also set DATABASE_URL yourself; this function will accept either.

const connectionString = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;

if (!connectionString) {
  console.warn('Missing DATABASE_URL / NETLIFY_DATABASE_URL environment variable');
}

const pool = connectionString ? new Pool({ connectionString }) : null;

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
    const q = `SELECT id, title, note, created_at, activity_date, count, location, latitude AS lat, longitude AS lng, attachment_url, raw
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
      const activity_type = rawObj && rawObj.activity_type ? String(rawObj.activity_type) : '';

      // Do not return raw by default (keeps payload small), only derived fields.
      const { raw, ...rest } = r;
      return {
        ...rest,
        activity_type,
        highlights: highlights || ''
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
