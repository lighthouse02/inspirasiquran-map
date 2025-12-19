const { Pool } = require('pg');

// Netlify function to return activities from Neon Postgres.
// Set environment variable DATABASE_URL in Netlify site settings.

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

exports.handler = async function(event) {
  try {
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
