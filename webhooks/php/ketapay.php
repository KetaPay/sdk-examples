<?php

// Shared by the server and the scripts: the client, the secrets, and where handled events are kept

declare(strict_types=1);

require __DIR__ . '/vendor/autoload.php';

use KetaPay\KetaPay;
use KetaPay\Models\Event;

// ../.env when there is one (shared with the Node version); environment variables win over it
foreach (is_file(__DIR__ . '/../.env') ? file(__DIR__ . '/../.env', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [] as $line) {
    if (!str_starts_with(trim($line), '#') && str_contains($line, '=')) {
        [$name, $value] = explode('=', $line, 2);
        $_ENV[trim($name)] ??= trim($value);
    }
}
function env(string $name): ?string
{
    return (getenv($name) ?: ($_ENV[$name] ?? '')) ?: null;
}

if (!str_starts_with((string) env('KETAPAY_SECRET_KEY'), 'sk_test_')) {
    fwrite(STDERR, "Set KETAPAY_SECRET_KEY to your sk_test_ key in webhooks/.env (see .env.example).\n");
    exit(1);
}

$ketapay = new KetaPay(array_filter(['apiKey' => env('KETAPAY_SECRET_KEY'), 'baseUrl' => env('KETAPAY_BASE_URL')]));

// Both secrets while a rotation is under way: a delivery signed with either is genuine
$secrets = array_values(array_filter([env('KETAPAY_WEBHOOK_SECRET'), env('KETAPAY_WEBHOOK_SECRET_PREVIOUS')]));

// Your database. A JSON file here: the ids of events already handled, and the newest one's time.
const STORE = __DIR__ . '/handled.json';

/** @return array{ids: list<string>, since: ?string} */
function store(): array
{
    return is_file(STORE) ? json_decode((string) file_get_contents(STORE), true) : ['ids' => [], 'since' => null];
}

// Handles an event once, however often it arrives: KetaPay retries until you answer 2xx, and
// `catch-up` may fetch one the server also got. Returns false when it was already handled.
function handle(Event $event): bool
{
    $store = store();
    if (in_array($event->id, $store['ids'], true)) {
        return false;
    }
    // Your work goes here: mark the order paid, email the seller, update your books...
    error_log("{$event->created_at}  {$event->type}  " . ($event->data->object->id ?? ''));
    $store['ids'][] = $event->id;
    if ($store['since'] === null || $event->created_at > $store['since']) {
        $store['since'] = $event->created_at;
    }
    file_put_contents(STORE, json_encode($store), LOCK_EX);

    return true;
}

function lastHandledAt(): ?string
{
    return store()['since'];
}
