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
    const q = `SELECT id, title, note, created_at, activity_date, count, location, latitude AS lat, longitude AS lng, attachment_url
               FROM activities
               ORDER BY COALESCE(activity_date, created_at) ASC, created_at ASC`;
    const res = await pool.query(q);
    const rows = res.rows.map(r => ({
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
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rows)
    };
  } catch (err) {
    console.error('get-activities error', err);
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
  }
};
