<?php

// Receives KetaPay's webhooks: verifies each one, handles it once, and answers 200 quickly.
// Run: composer start, then expose port 4242 over https (a tunnel, or a public Codespaces port).

declare(strict_types=1);

require __DIR__ . '/ketapay.php';

use KetaPay\Errors\WebhookSignatureError;

if ($_SERVER['REQUEST_METHOD'] !== 'POST' || parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) !== '/webhooks') {
    http_response_code(404);

    return;
}

// Read the raw body: the signature covers it exactly, so parse JSON only after verifying
try {
    $event = $ketapay->webhooks->verify((string) file_get_contents('php://input'), $_SERVER['HTTP_KETAPAY_SIGNATURE'] ?? null, $secrets);
} catch (WebhookSignatureError $e) {
    // A bad signature, or one older than 5 minutes (a replay): refuse it
    error_log('Refused: ' . $e->getMessage());
    http_response_code(400);

    return;
}

// Answer fast. Slow work belongs in a queue; KetaPay retries anything that isn't a 2xx.
if (!handle($event)) {
    error_log("{$event->type} {$event->id} again: already handled");
}
http_response_code(200);
