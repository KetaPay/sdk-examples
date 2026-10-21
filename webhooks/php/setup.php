<?php

// Adds a webhook endpoint for your server and prints its signing secret, which is shown only now.
// Usage: composer setup -- https://your-address/webhooks

declare(strict_types=1);

require __DIR__ . '/ketapay.php';

$url = $argv[1] ?? '';
if (!str_starts_with($url, 'https://')) {
    fwrite(STDERR, "Usage: composer setup -- https://your-address/webhooks (KetaPay only sends to https)\n");
    exit(1);
}
$endpoint = $ketapay->webhookEndpoints->create([
    'url' => $url,
    'description' => 'sdk-examples webhooks',
    // Leave enabled_events out to get every event, including ones added later
    'enabled_events' => ['escrow.funded', 'milestone.delivered', 'milestone.released', 'escrow.completed', 'escrow.refunded'],
]);
echo "Endpoint {$endpoint->id} sends " . count($endpoint->enabled_events) . " events to {$endpoint->url}\n";
echo "\nAdd this to webhooks/.env (it is not shown again):\nKETAPAY_WEBHOOK_SECRET={$endpoint->secret}\n";
