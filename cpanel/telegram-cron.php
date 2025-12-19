<?php
// Telegram polling bot for shared hosting (cron-driven).
// Use this if webhook is difficult (no HTTPS / inbound blocked).
//
// Setup:
// - Set TELEGRAM_BOT_TOKEN (env var), OR hardcode below.
// - Create a cron job to run this file every 1 minute.
//
// This script calls getUpdates, processes /add, appends to activities.json,
// and stores the last update_id in telegram-offset.json.

$BOT_TOKEN = getenv('TELEGRAM_BOT_TOKEN');
if (!$BOT_TOKEN) {
  // Fallback: hardcode if your hosting doesn't support env vars.
  // $BOT_TOKEN = '123456:ABCDEF...';
}

header('Content-Type: application/json; charset=utf-8');

if (!$BOT_TOKEN) {
  http_response_code(500);
  echo json_encode([ 'ok' => false, 'error' => 'missing TELEGRAM_BOT_TOKEN' ]);
  exit;
}

function tg_get($token, $method, $query) {
  $url = 'https://api.telegram.org/bot' . $token . '/' . $method;
  if ($query) $url .= '?' . http_build_query($query);
  $resp = @file_get_contents($url);
  if ($resp === false) return null;
  return json_decode($resp, true);
}

function tg_post($token, $method, $payload) {
  $url = 'https://api.telegram.org/bot' . $token . '/' . $method;
  $opts = [
    'http' => [
      'method' => 'POST',
      'header' => "Content-Type: application/json\r\n",
      'content' => json_encode($payload),
      'timeout' => 10
    ]
  ];
  $ctx = stream_context_create($opts);
  $resp = @file_get_contents($url, false, $ctx);
  if ($resp === false) return null;
  return json_decode($resp, true);
}

function reply($token, $chatId, $text) {
  tg_post($token, 'sendMessage', [
    'chat_id' => $chatId,
    'text' => $text,
    'disable_web_page_preview' => true
  ]);
}

function load_json($path, $fallback) {
  if (!file_exists($path)) return $fallback;
  $j = file_get_contents($path);
  $d = json_decode($j, true);
  return is_array($d) ? $d : $fallback;
}

function save_json($path, $value) {
  $tmp = $path . '.tmp';
  $json = json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
  if (file_put_contents($tmp, $json) === false) return false;
  return rename($tmp, $path);
}

$offsetPath = __DIR__ . '/telegram-offset.json';
$offsetData = load_json($offsetPath, [ 'offset' => 0 ]);
$offset = intval($offsetData['offset'] ?? 0);

$updates = tg_get($BOT_TOKEN, 'getUpdates', [
  'offset' => $offset,
  'timeout' => 0,
  'allowed_updates' => json_encode(['message'])
]);

if (!$updates || !($updates['ok'] ?? false)) {
  echo json_encode([ 'ok' => false, 'error' => 'getUpdates failed', 'resp' => $updates ]);
  exit;
}

$results = $updates['result'] ?? [];

$activitiesPath = __DIR__ . '/activities.json';
$activities = load_json($activitiesPath, []);

$handled = 0;
$maxUpdateId = null;

foreach ($results as $u) {
  $updateId = intval($u['update_id'] ?? 0);
  if ($maxUpdateId === null || $updateId > $maxUpdateId) $maxUpdateId = $updateId;

  $msg = $u['message'] ?? null;
  if (!$msg) continue;
  $chatId = $msg['chat']['id'] ?? null;
  $text = trim($msg['text'] ?? '');
  if (!$chatId || $text === '') continue;

  if (strpos($text, '/add') === 0) {
    $rest = trim(substr($text, 4));
    if ($rest === '') {
      reply($BOT_TOKEN, $chatId, "Usage:\n/add <title> | <count> | <location> | <lat>,<lng> | <note>");
      $handled++;
      continue;
    }

    $parts = array_map('trim', explode('|', $rest));
    $title = $parts[0] ?? 'Activity';
    $count = isset($parts[1]) ? intval($parts[1]) : null;
    $location = $parts[2] ?? '';
    $latlng = $parts[3] ?? '';
    $note = $parts[4] ?? '';

    $lat = null; $lng = null;
    if ($latlng !== '' && strpos($latlng, ',') !== false) {
      $ll = array_map('trim', explode(',', $latlng));
      if (count($ll) >= 2) {
        $lat = floatval($ll[0]);
        $lng = floatval($ll[1]);
      }
    }

    $activities[] = [
      'id' => 'act-' . date('Ymd-His') . '-' . substr(bin2hex(random_bytes(4)), 0, 8),
      'title' => $title,
      'date' => gmdate('c'),
      'count' => $count,
      'location' => $location,
      'lat' => $lat,
      'lng' => $lng,
      'note' => $note
    ];

    reply($BOT_TOKEN, $chatId, "Saved ✅\n" . $title);
    $handled++;
  }
}

if ($handled > 0) {
  save_json($activitiesPath, $activities);
}

if ($maxUpdateId !== null) {
  save_json($offsetPath, [ 'offset' => $maxUpdateId + 1 ]);
}

echo json_encode([ 'ok' => true, 'handled' => $handled, 'fetched' => count($results) ]);
