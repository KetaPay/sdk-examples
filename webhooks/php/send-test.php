<?php

// Asks KetaPay to send a sample event to your endpoint now, and shows how your server answered.
// Usage: composer send-test -- <endpoint id> [event type, default escrow.funded]

declare(strict_types=1);

require __DIR__ . '/ketapay.php';

if (!isset($argv[1])) {
    fwrite(STDERR, "Usage: composer send-test -- <endpoint id> [event type]\n");
    exit(1);
}
print_r($ketapay->webhookEndpoints->test($argv[1], $argv[2] ?? 'escrow.funded')->toArray());
