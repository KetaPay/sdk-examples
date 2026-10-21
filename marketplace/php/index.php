<?php

// Swapmart: a marketplace where customers buy from and sell to each other. KetaPay holds the money,
// and Swapmart takes a commission on each sale. The same routes as ../node:
//
// 1. POST /listings/{id}/buy                 checkout session with the buyer, the listing's seller and the commission
// 2. KetaPay's checkout page                 the buyer pays; KetaPay holds the money
// 3. POST /orders/{id}/seller/code|confirm   the seller proves it's them with a one-time code, then marks it sent
// 4. POST /orders/{id}/buyer/code|confirm    the buyer proves it's them, then confirms it arrived: the seller is paid
// 5. POST /webhooks                          keeps the order in step with KetaPay, whatever happens elsewhere
//
// Swapmart's key alone never moves its customers' money: each step that does needs that customer's token.
// Run: composer start (PHP's built-in server, with this file as the router)

declare(strict_types=1);

require __DIR__ . '/vendor/autoload.php';

use KetaPay\Errors\KetaPayError;
use KetaPay\Errors\WebhookSignatureError;
use KetaPay\KetaPay;

// ../.env when there is one (shared with the Node version); environment variables win over it
foreach (is_file(__DIR__ . '/../.env') ? file(__DIR__ . '/../.env', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [] as $line) {
    if (!str_starts_with(trim($line), '#') && str_contains($line, '=')) {
        [$name, $value] = explode('=', $line, 2);
        $_ENV[trim($name)] ??= trim($value);
    }
}
$env = static fn(string $name, ?string $default = null): ?string => (getenv($name) ?: ($_ENV[$name] ?? '')) ?: $default;

if (!str_starts_with((string) $env('KETAPAY_SECRET_KEY'), 'sk_test_')) {
    http_response_code(500);
    exit('Set KETAPAY_SECRET_KEY to your sk_test_ key in marketplace/.env (see .env.example).');
}
$ketapay = new KetaPay(array_filter(['apiKey' => $env('KETAPAY_SECRET_KEY'), 'baseUrl' => $env('KETAPAY_BASE_URL')]));
$baseUrl = $env('BASE_URL', 'http://localhost:4242');

// Your database. A JSON file here, since PHP starts fresh on every request.
const LISTINGS = [
    'iphone-15' => [
        'title' => 'iPhone 15 Pro Max, 256GB',
        'description' => 'Used, 91% battery, no scratches, Face ID works. Box and cable included.',
        'price' => 45_000_000, // kobo: ₦450,000
        'seller' => ['email' => 'tunde@example.com', 'name' => 'Tunde Bello'],
    ],
    'ps5' => [
        'title' => 'PlayStation 5, disc edition',
        'description' => 'Bought 2024, two controllers, all cables, works perfectly. Original box.',
        'price' => 52_000_000,
        'seller' => ['email' => 'chioma@example.com', 'name' => 'Chioma Eze'],
    ],
    'bicycle' => [
        'title' => 'Road bike, 54cm frame',
        'description' => 'Aluminium frame, Shimano gears, new tyres, serviced last month. Pickup in Yaba.',
        'price' => 18_000_000,
        'seller' => ['email' => 'musa@example.com', 'name' => 'Musa Bello'],
    ],
];
$store = __DIR__ . '/var/orders.json';
$orders = static fn(): array => is_file($store) ? json_decode((string) file_get_contents($store), true) : [];
$save = static function (array $order) use ($store, $orders): array {
    @mkdir(dirname($store));
    $all = $orders();
    $all[$order['id']] = $order;
    file_put_contents($store, json_encode($all), LOCK_EX);

    return $order;
};
$summary = static fn(array $o): array => array_intersect_key($o, array_flip(['id', 'title', 'buyer', 'seller', 'status', 'commission']));
$json = static function (mixed $body, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($body);
};
$input = static fn(): array => json_decode((string) file_get_contents('php://input'), true) ?: [];

$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';

// Swapmart's pages, shared with the Node version
$file = realpath(__DIR__ . '/../public' . ($path === '/' ? '/index.html' : $path));
if ($method === 'GET' && $file !== false && str_starts_with($file, realpath(__DIR__ . '/../public')) && is_file($file)) {
    $types = ['html' => 'text/html', 'css' => 'text/css', 'js' => 'text/javascript'];
    header('Content-Type: ' . ($types[pathinfo($file, PATHINFO_EXTENSION)] ?? 'application/octet-stream'));
    readfile($file);

    return;
}

try {
    if ($method === 'GET' && $path === '/api/listings') {
        $json(array_map(static fn(string $id, array $l): array => ['id' => $id, 'title' => $l['title'], 'price' => $l['price'], 'seller' => $l['seller']['name']], array_keys(LISTINGS), LISTINGS));

        return;
    }

    // Step 1: the buyer clicked "Buy with escrow"
    if ($method === 'POST' && preg_match('#^/listings/([^/]+)/buy$#', $path, $m)) {
        $isJson = str_contains($_SERVER['CONTENT_TYPE'] ?? '', 'application/json');
        $form = $isJson ? $input() : $_POST;
        $listing = LISTINGS[$m[1]] ?? null;
        if ($listing === null) {
            http_response_code(404);

            return;
        }
        $email = (string) ($form['email'] ?? '');
        $order = ['id' => bin2hex(random_bytes(16)), 'title' => $listing['title'], 'status' => 'awaiting_payment', 'escrow_id' => null, 'webhooks' => []];
        $session = $ketapay->checkoutSessions->create([
            'amount' => $listing['price'],
            'category' => 'goods',
            'title' => $listing['title'],
            'description' => $listing['description'],
            'buyer' => ['email' => $email],
            'seller' => $listing['seller'],
            // Swapmart's cut, taken from the seller's side when the money is released
            'commission' => ['rate_bps' => (int) $env('COMMISSION_BPS', '500')],
            'external_reference' => $order['id'],
            'return_url' => "$baseUrl/order.html?order={$order['id']}",
        ]);
        $save($order + ['buyer' => $email, 'seller' => $listing['seller']['email'], 'commission' => $session->fees->commission]);
        if ($isJson) {
            // A JSON post ("Pay on this page", @ketapay/checkout) gets the url back to open over the page
            $json(['url' => $session->url, 'return_url' => $session->return_url]);

            return;
        }
        header('Location: ' . $session->url, true, 303);

        return;
    }

    // Steps 3 and 4, first half: KetaPay sends this customer a one-time code
    if ($method === 'POST' && preg_match('#^/orders/([^/]+)/(seller|buyer)/code$#', $path, $m)) {
        $order = $orders()[$m[1]] ?? null;
        if ($order === null) {
            http_response_code(404);

            return;
        }
        $json(['session_id' => $ketapay->customerSessions->create(['email' => $order[$m[2]]])->id]);

        return;
    }

    // Second half: the code proves it's them, and their token lets Swapmart act for them, this once
    if ($method === 'POST' && preg_match('#^/orders/([^/]+)/(seller|buyer)/confirm$#', $path, $m)) {
        $order = $orders()[$m[1]] ?? null;
        if ($order === null || $order['escrow_id'] === null) {
            http_response_code(404);

            return;
        }
        $body = $input();
        $token = (string) $ketapay->customerSessions->verify((string) ($body['session_id'] ?? ''), (string) ($body['code'] ?? ''))->token;
        $escrow = $ketapay->escrows->retrieve($order['escrow_id']);
        $milestone = $escrow->milestones[0];
        if ($m[2] === 'seller') {
            $ketapay->escrows->milestones->deliver($escrow->id, $milestone->id, ['note' => 'Sent with GIG Logistics'], ['customerToken' => $token]);
            $order['status'] = 'shipped';
        } else {
            $ketapay->escrows->milestones->release($escrow->id, $milestone->id, [], ['customerToken' => $token]);
            $order['status'] = 'completed';
        }
        $json($summary($save($order)));

        return;
    }

    // Step 5: KetaPay tells Swapmart what happened. Read the raw body: the signature covers it exactly.
    if ($method === 'POST' && $path === '/webhooks') {
        try {
            $event = $ketapay->webhooks->verify((string) file_get_contents('php://input'), $_SERVER['HTTP_KETAPAY_SIGNATURE'] ?? null, (string) $env('KETAPAY_WEBHOOK_SECRET'));
        } catch (WebhookSignatureError $e) {
            error_log('Refused a webhook: ' . $e->getMessage());
            http_response_code(400);

            return;
        }
        $escrow = $event->data->object;
        $order = $orders()[$escrow->external_reference ?? ''] ?? null;
        if ($order !== null) {
            $order['webhooks'][] = ['type' => $event->type, 'received_at' => gmdate('Y-m-d\TH:i:s\Z')];
            $order = match ($event->type) {
                'escrow.funded' => ['status' => 'paid', 'escrow_id' => $escrow->id] + $order,
                'milestone.delivered' => ['status' => 'shipped'] + $order,
                'escrow.completed' => ['status' => 'completed'] + $order,
                'escrow.refunded' => ['status' => 'refunded'] + $order,
                default => $order,
            };
            $save($order);
            error_log("{$event->type}: order {$order['id']} is {$order['status']}");
        }
        http_response_code(200);

        return;
    }

    // The platform admin's list, newest first, with the commission each sale earns
    if ($method === 'GET' && $path === '/orders') {
        $json(array_map($summary, array_reverse(array_values($orders()))));

        return;
    }

    if ($method === 'GET' && preg_match('#^/orders/([^/]+)(/activity)?$#', $path, $m)) {
        $order = $orders()[$m[1]] ?? null;
        if ($order === null) {
            http_response_code(404);

            return;
        }
        if (!isset($m[2])) {
            $json($summary($order));

            return;
        }
        // The "what's happening" panel: the escrow as KetaPay has it, and the webhooks Swapmart received
        $escrow = $order['escrow_id'] !== null ? $ketapay->escrows->retrieve($order['escrow_id'])->toArray() : null;
        $json(['escrow' => $escrow, 'webhooks' => $order['webhooks']]);

        return;
    }

    http_response_code(404);
} catch (KetaPayError $e) {
    // A wrong code or a step out of order comes back as a KetaPay error with a message to show
    $json(['error' => $e->getMessage(), 'code' => $e->code], $e->statusCode ?? 400);
}
