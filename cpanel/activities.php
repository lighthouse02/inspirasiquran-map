<?php
// Simple public API for the Netlify frontend.
// Returns a JSON array of activities.
// Data source: ../activities.json (upload this file alongside this script on cPanel)
//
// Optional: set $ALLOW_ORIGIN to your Netlify site origin to tighten CORS.

$ALLOW_ORIGIN = '*';
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: ' . $ALLOW_ORIGIN);
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

$path = __DIR__ . '/activities.json';
if (!file_exists($path)) {
  // fallback: if you place it one level up
  $path2 = dirname(__DIR__) . '/activities.json';
  if (file_exists($path2)) $path = $path2;
}

if (!file_exists($path)) {
  http_response_code(404);
  echo json_encode([ 'error' => 'activities.json not found' ]);
  exit;
}

$json = file_get_contents($path);
if ($json === false) {
  http_response_code(500);
  echo json_encode([ 'error' => 'failed to read activities.json' ]);
  exit;
}

// Ensure it is an array; if invalid, return empty array
$data = json_decode($json, true);
if (!is_array($data)) $data = [];

echo json_encode($data);
