<?php
// Telegram webhook receiver for shared hosting.
//
// How it works:
// - Set TELEGRAM_BOT_TOKEN in this file (or via cPanel env if available)
// - Point Telegram webhook to: https://YOURDOMAIN.com/path/to/telegram-webhook.php
// - This script listens for /add and appends to activities.json
//
// Commands supported (minimal):
//   /add <title> | <count> | <location> | <lat>,<lng> | <note>
// Example:
//   /add Distribution | 100 | USIM, Nilai | 2.8437,101.7837 | Alhamdulillah
//
// Notes:
// - Telegram requires HTTPS for webhooks.
// - This stores activities in a JSON file (activities.json) next to this script.

$BOT_TOKEN = getenv('TELEGRAM_BOT_TOKEN');
if (!$BOT_TOKEN) {
  // Fallback: hardcode if your hosting doesn't support env vars.
  // $BOT_TOKEN = '123456:ABCDEF...';
}

header('Content-Type: application/json; charset=utf-8');

$raw = file_get_contents('php://input');
$update = json_decode($raw, true);
if (!is_array($update)) {
  http_response_code(400);
  echo json_encode([ 'ok' => false, 'error' => 'invalid JSON' ]);
  exit;
}

function tg_api($token, $method, $payload) {
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
  return $resp;
}

function reply($token, $chatId, $text) {
  if (!$token) return;
  tg_api($token, 'sendMessage', [
    'chat_id' => $chatId,
    'text' => $text,
    'disable_web_page_preview' => true
  ]);
}

function load_activities($path) {
  if (!file_exists($path)) return [];
  $json = file_get_contents($path);
  $data = json_decode($json, true);
  return is_array($data) ? $data : [];
}

function save_activities($path, $activities) {
  $tmp = $path . '.tmp';
  $json = json_encode($activities, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
  if (file_put_contents($tmp, $json) === false) return false;
  return rename($tmp, $path);
}

// Extract message text
$message = $update['message'] ?? null;
if (!$message) {
  echo json_encode([ 'ok' => true, 'ignored' => true ]);
  exit;
}

$chatId = $message['chat']['id'] ?? null;
$text = trim($message['text'] ?? '');

if (!$chatId || $text === '') {
  echo json_encode([ 'ok' => true, 'ignored' => true ]);
  exit;
}

if (!$BOT_TOKEN) {
  reply($BOT_TOKEN, $chatId, 'Bot token not configured on server.');
  echo json_encode([ 'ok' => false, 'error' => 'missing token' ]);
  exit;
}

if (strpos($text, '/add') === 0) {
  $rest = trim(substr($text, 4));
  if ($rest === '') {
    reply($BOT_TOKEN, $chatId, "Usage:\n/add <title> | <count> | <location> | <lat>,<lng> | <note>");
    echo json_encode([ 'ok' => true ]);
    exit;
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

  $activity = [
    'id' => 'act-' . date('Ymd-His') . '-' . substr(bin2hex(random_bytes(4)), 0, 8),
    'title' => $title,
    'date' => gmdate('c'),
    'count' => $count,
    'location' => $location,
    'lat' => $lat,
    'lng' => $lng,
    'note' => $note
  ];

  $path = __DIR__ . '/activities.json';
  $activities = load_activities($path);
  $activities[] = $activity;

  if (!save_activities($path, $activities)) {
    reply($BOT_TOKEN, $chatId, 'Failed to save activity (file write error).');
    echo json_encode([ 'ok' => false, 'error' => 'write failed' ]);
    exit;
  }

  reply($BOT_TOKEN, $chatId, "Saved ✅\n" . $title);
  echo json_encode([ 'ok' => true ]);
  exit;
}

reply($BOT_TOKEN, $chatId, "Commands:\n/add <title> | <count> | <location> | <lat>,<lng> | <note>");
echo json_encode([ 'ok' => true ]);
