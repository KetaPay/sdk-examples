<?php

// Replaces the endpoint's signing secret, for example after it leaked. KetaPay signs with both the
// new and the old secret for a while, so you can deploy the new one without missing a delivery.
// Usage: composer rotate -- <endpoint id>

declare(strict_types=1);

require __DIR__ . '/ketapay.php';

if (!isset($argv[1])) {
    fwrite(STDERR, "Usage: composer rotate -- <endpoint id>\n");
    exit(1);
}
$rotated = $ketapay->webhookEndpoints->rotateSecret($argv[1]);
echo "Update webhooks/.env, then restart the server (the new secret is not shown again):\n";
echo "KETAPAY_WEBHOOK_SECRET={$rotated->secret}\n";
echo 'KETAPAY_WEBHOOK_SECRET_PREVIOUS=' . (env('KETAPAY_WEBHOOK_SECRET') ?? '<your old secret>') . "\n";
echo "The old secret stops signing at {$rotated->previous_secret_expires_at}: remove it from .env after that.\n";
