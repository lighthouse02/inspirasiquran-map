/*
Backfill derived fields into the `activities` table.

- Ensures `raw` JSON contains: mission, activity_type, count_number
- Optionally updates columns mission/activity_type/count_number if they exist

Usage (PowerShell):
  cd telegram-bot
  node scripts/backfill-activities-derived-fields.js

Env:
  DATABASE_URL or NETLIFY_DATABASE_URL (same as bot)

Options:
  --dry-run   Show what would change, don't write
  --limit N   Limit rows processed (default: no limit)
*/

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
if(!connectionString){
  console.error('Missing DATABASE_URL / NETLIFY_DATABASE_URL');
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIdx = args.findIndex(a => a === '--limit');
const limit = (limitIdx >= 0 && args[limitIdx + 1]) ? Math.max(1, Number(args[limitIdx + 1])) : null;

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

function parseCountryFromLocationLoose(location){
  const s = String(location || '').trim();
  if(!s) return '';
  const parts = s.split(',').map(p => p.trim()).filter(Boolean);
  if(parts.length >= 2) return parts[parts.length - 1];
  return '';
}

async function getActivitiesColumns(pool){
  const res = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activities'"
  );
  return new Set((res.rows || []).map(r => String(r.column_name || '').trim()).filter(Boolean));
}

async function main(){
  const pool = new Pool({ connectionString });
  try{
    const cols = await getActivitiesColumns(pool);
    const hasMission = cols.has('mission');
    const hasActivityType = cols.has('activity_type');
    const hasCountNumber = cols.has('count_number');
    const hasCountry = cols.has('country');

    const selectCols = ['id', 'count', 'raw'];
    if(hasMission) selectCols.push('mission');
    if(hasActivityType) selectCols.push('activity_type');
    if(hasCountNumber) selectCols.push('count_number');
    if(hasCountry) selectCols.push('country');

    const q = `SELECT ${selectCols.join(', ')} FROM activities ORDER BY COALESCE(activity_date, created_at) ASC` + (limit ? ` LIMIT ${limit}` : '');
    const res = await pool.query(q);

    let scanned = 0;
    let updated = 0;

    for(const row of (res.rows || [])){
      scanned++;
      const id = String(row.id);

      let rawObj = null;
      try{
        if(row.raw && typeof row.raw === 'string') rawObj = JSON.parse(row.raw);
        else if(row.raw && typeof row.raw === 'object') rawObj = row.raw;
      }catch(e){ rawObj = null; }

      if(!rawObj || typeof rawObj !== 'object') rawObj = {};

      const mission = rawObj.mission != null ? String(rawObj.mission) : (row.mission != null ? String(row.mission) : '');
      const activityType = rawObj.activity_type != null ? String(rawObj.activity_type) : (row.activity_type != null ? String(row.activity_type) : '');
      const location = (rawObj.location != null) ? String(rawObj.location) : (row.location != null ? String(row.location) : '');
      const country = rawObj.country != null ? String(rawObj.country) : (row.country != null ? String(row.country) : parseCountryFromLocationLoose(location));

      const sourceCount = (rawObj.count != null) ? rawObj.count : row.count;
      const countNumber = (rawObj.count_number != null)
        ? (Number.isFinite(Number(rawObj.count_number)) ? Math.round(Number(rawObj.count_number)) : parseCountNumberLoose(rawObj.count_number))
        : parseCountNumberLoose(sourceCount);

      const nextRaw = { ...rawObj, mission, activity_type: activityType, country, count_number: (countNumber == null ? null : countNumber) };

      const rawChanged = JSON.stringify(nextRaw) !== JSON.stringify(rawObj);
      const missionChanged = hasMission && (row.mission == null ? '' : String(row.mission)) !== mission;
      const typeChanged = hasActivityType && (row.activity_type == null ? '' : String(row.activity_type)) !== activityType;
      const countNumChanged = hasCountNumber && (row.count_number == null ? null : Number(row.count_number)) !== (countNumber == null ? null : Number(countNumber));
      const countryChanged = hasCountry && (row.country == null ? '' : String(row.country)) !== country;

      if(!(rawChanged || missionChanged || typeChanged || countNumChanged || countryChanged)) continue;

      updated++;
      if(dryRun){
        console.log(`[dry-run] would update ${id}: raw=${rawChanged} mission=${missionChanged} type=${typeChanged} country=${countryChanged} count_number=${countNumChanged}`);
        continue;
      }

      const assignments = [];
      const values = [id];
      function add(col, val){ assignments.push(`${col} = $${values.length + 1}`); values.push(val); }

      add('raw', JSON.stringify(nextRaw));
      if(hasMission) add('mission', mission || null);
      if(hasActivityType) add('activity_type', activityType || null);
      if(hasCountry) add('country', country || null);
      if(hasCountNumber) add('count_number', countNumber == null ? null : Number(countNumber));

      const uq = `UPDATE activities SET ${assignments.join(', ')} WHERE id = $1`;
      await pool.query(uq, values);

      if(updated % 200 === 0) console.log(`Updated ${updated} rows...`);
    }

    console.log(`Scanned ${scanned} rows; ${dryRun ? 'would update' : 'updated'} ${updated}.`);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
