<?php

// Handles every event your server missed while it was down. KetaPay keeps them: list everything since
// the newest event you handled, oldest first, and handle each once (handled ones are skipped).
// Usage: composer catch-up

declare(strict_types=1);

require __DIR__ . '/ketapay.php';

$since = lastHandledAt() ?? gmdate('Y-m-d\TH:i:s\Z', time() - 24 * 60 * 60);
$missed = [];
// Lists come newest first, a page at a time; foreach walks every page
foreach ($ketapay->events->list(['created_gte' => $since, 'limit' => 100]) as $event) {
    $missed[] = $event;
}

$handled = 0;
foreach (array_reverse($missed) as $event) {
    $handled += handle($event) ? 1 : 0;
}
echo "Caught up: $handled new of " . count($missed) . " events since $since\n";
