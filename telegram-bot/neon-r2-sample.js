/*
Sample bot helper: download a Telegram file, upload to S3-compatible object storage (Cloudflare R2 / DO Spaces / S3),
then insert an activity row into Neon Postgres.

Environment variables required:
- TELEGRAM_BOT_TOKEN (if using Telegram APIs here)
- DATABASE_URL (Postgres/Neon connection string)
- R2_ENDPOINT (e.g. https://<accountid>.r2.cloudflarestorage.com)
- R2_BUCKET
- R2_PUBLIC_BASE (public base URL where uploaded objects are served, e.g. https://<account>.r2.dev/<bucket>)
- R2_ACCESS_KEY_ID
- R2_SECRET_ACCESS_KEY

Install dependencies:
  npm install pg @aws-sdk/client-s3 node-fetch

This is a minimal example — integrate into your existing guided bot flow.
*/

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { Pool } = require('pg');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  },
  forcePathStyle: false
});

async function uploadBufferToBucket(buffer, key, contentType){
  const cmd = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType
  });
  await s3.send(cmd);
  // public URL (depends on provider)
  return `${process.env.R2_PUBLIC_BASE.replace(/\/$/, '')}/${encodeURIComponent(key)}`;
}

async function saveActivityToDb(activity){
  const sql = `INSERT INTO activities(title, note, activity_date, count, location, latitude, longitude, attachment_url, attachment_type, raw)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`;
  const vals = [ activity.title, activity.note || null, activity.activity_date || null, activity.count || null, activity.location || null, activity.lat || null, activity.lng || null, activity.attachment_url || null, activity.attachment_type || null, JSON.stringify(activity) ];
  const r = await pool.query(sql, vals);
  return r.rows[0];
}

async function downloadTelegramFile(fileUrl){
  const r = await fetch(fileUrl);
  if(!r.ok) throw new Error('download failed: '+r.status);
  const buf = await r.buffer();
  const contentType = r.headers.get('content-type') || 'application/octet-stream';
  return { buffer: buf, contentType };
}

// Example usage inside your bot flow: you already have file URL from Telegram (via getFile)
async function handleIncomingActivityExample(){
  // Example inputs (replace with actual bot-captured values)
  const title = 'New distribution';
  const note = 'Packed today';
  const activity_date = new Date().toISOString();
  const count = '500 Mushaf';
  const location = 'Ouagadougou';
  const lat = 12.3714277; const lng = -1.5196603;
  const telegramFileUrl = 'https://api.telegram.org/file/bot<token>/path/to/file.jpg'; // replace with real

  // download file
  const { buffer, contentType } = await downloadTelegramFile(telegramFileUrl);
  const key = `uploads/${Date.now()}-${Math.random().toString(36).slice(2,8)}.jpg`;
  const publicUrl = await uploadBufferToBucket(buffer, key, contentType);

  // save in DB
  const saved = await saveActivityToDb({ title, note, activity_date, count, location, lat, lng, attachment_url: publicUrl, attachment_type: 'photo' });
  console.log('saved activity', saved);
}

module.exports = { uploadBufferToBucket, saveActivityToDb, downloadTelegramFile };
