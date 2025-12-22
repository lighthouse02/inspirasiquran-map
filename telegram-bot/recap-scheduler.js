/*
  Daily Recap Scheduler (fallback when Railway Cron UI isn't available)

  - Runs forever
  - Executes recap-daily.js once per day at a configured local time
  - Safe to run as a separate Railway Service because it does NOT use polling/getUpdates

  Env:
    - RECAP_TZ_OFFSET_MINUTES (default 480 for MYT)
    - RECAP_RUN_LOCAL_HH (default 22)
    - RECAP_RUN_LOCAL_MM (default 0)

  It spawns: node recap-daily.js
*/

const { spawn } = require('child_process');

const RECAP_TZ_OFFSET_MINUTES = Number(process.env.RECAP_TZ_OFFSET_MINUTES || 480);
const RECAP_RUN_LOCAL_HH = Number(process.env.RECAP_RUN_LOCAL_HH || 22);
const RECAP_RUN_LOCAL_MM = Number(process.env.RECAP_RUN_LOCAL_MM || 0);

function toInt(n, fallback){
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function sleep(ms){
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeNextRunUtc(now = new Date()){
  const offsetMs = RECAP_TZ_OFFSET_MINUTES * 60 * 1000;
  const localNow = new Date(now.getTime() + offsetMs);

  const hh = Math.max(0, Math.min(23, toInt(RECAP_RUN_LOCAL_HH, 22)));
  const mm = Math.max(0, Math.min(59, toInt(RECAP_RUN_LOCAL_MM, 0)));

  // Build local target time for today.
  const y = localNow.getUTCFullYear();
  const m = localNow.getUTCMonth();
  const d = localNow.getUTCDate();

  let localTarget = new Date(Date.UTC(y, m, d, hh, mm, 0, 0));
  // If already passed, schedule for tomorrow.
  if(localTarget.getTime() <= localNow.getTime()){
    localTarget = new Date(Date.UTC(y, m, d + 1, hh, mm, 0, 0));
  }

  const utcTarget = new Date(localTarget.getTime() - offsetMs);
  return { utcTarget, localTarget };
}

async function runOnce(){
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['recap-daily.js'], {
      stdio: 'inherit',
      env: process.env,
      cwd: __dirname
    });

    child.on('exit', (code) => {
      if(code !== 0) console.error('[recap-scheduler] recap-daily.js exited with code', code);
      resolve();
    });
  });
}

async function main(){
  console.log('[recap-scheduler] started');
  console.log('[recap-scheduler] tzOffsetMinutes=', RECAP_TZ_OFFSET_MINUTES, 'runLocal=', RECAP_RUN_LOCAL_HH + ':' + String(RECAP_RUN_LOCAL_MM).padStart(2,'0'));

  while(true){
    const { utcTarget, localTarget } = computeNextRunUtc(new Date());
    const waitMs = Math.max(0, utcTarget.getTime() - Date.now());

    console.log('[recap-scheduler] next run local=', localTarget.toISOString().replace('T',' ').slice(0,16), 'utc=', utcTarget.toISOString());
    await sleep(waitMs);

    try{
      console.log('[recap-scheduler] running recap-daily.js');
      await runOnce();
    }catch(e){
      console.error('[recap-scheduler] run failed', e && (e.message || e));
    }

    // Small buffer to avoid double-run if clock skews
    await sleep(30_000);
  }
}

main().catch((e) => {
  console.error('[recap-scheduler] fatal:', e);
  process.exitCode = 1;
});
