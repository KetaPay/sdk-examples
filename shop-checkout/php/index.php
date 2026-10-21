<?php

// Ade Gadgets: a shop selling its own goods, with KetaPay escrow as a way to pay. The same routes as ../node:
//
// 1. POST /checkout            a checkout session with no `seller`: the shop itself is the seller
// 2. KetaPay's checkout page   the buyer pays; KetaPay holds the money
// 3. POST /webhooks            escrow.funded marks the order paid; escrow.completed marks it done
// 4. POST /orders/{id}/ship    the shop marks it delivered with its key alone (it is the seller)
// 5. The buyer confirms delivery with KetaPay, and the shop is paid into its KetaPay balance
//
// Run: composer start (PHP's built-in server, with this file as the router)

declare(strict_types=1);

require __DIR__ . '/vendor/autoload.php';

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
    exit('Set KETAPAY_SECRET_KEY to your sk_test_ key in shop-checkout/.env (see .env.example).');
}
$ketapay = new KetaPay(array_filter(['apiKey' => $env('KETAPAY_SECRET_KEY'), 'baseUrl' => $env('KETAPAY_BASE_URL')]));
$baseUrl = $env('BASE_URL', 'http://localhost:4242');

// The catalog lives on the server: the price sent to KetaPay never comes from the browser
const PRODUCTS = [
    'lamp' => ['name' => 'Brass desk lamp', 'price' => 2_500_000, 'description' => 'Brass desk lamp with a warm LED bulb, brushed finish, boxed with a UK plug.'],
    'kettle' => ['name' => 'Glass electric kettle', 'price' => 3_800_000, 'description' => 'Borosilicate glass kettle, 1.7 litres, blue LED, auto shut-off. New and sealed.'],
    'headphones' => ['name' => 'Wireless headphones', 'price' => 6_200_000, 'description' => 'Over-ear wireless headphones, noise cancelling, 30-hour battery, carry case.'],
];

// Your database. A JSON file here, since PHP starts fresh on every request.
$store = __DIR__ . '/var/orders.json';
$orders = static fn(): array => is_file($store) ? json_decode((string) file_get_contents($store), true) : [];
$save = static function (array $order) use ($store, $orders): array {
    @mkdir(dirname($store));
    $all = $orders();
    $all[$order['id']] = $order;
    file_put_contents($store, json_encode($all), LOCK_EX);

    return $order;
};
$summary = static fn(array $o): array => ['id' => $o['id'], 'product' => $o['product'], 'buyer' => $o['buyer'], 'status' => $o['status']];
$json = static function (mixed $body, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($body);
};

$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';

// The shop's pages, shared with the Node version
$file = realpath(__DIR__ . '/../public' . ($path === '/' ? '/index.html' : $path));
if ($method === 'GET' && $file !== false && str_starts_with($file, realpath(__DIR__ . '/../public')) && is_file($file)) {
    $types = ['html' => 'text/html', 'css' => 'text/css', 'js' => 'text/javascript'];
    header('Content-Type: ' . ($types[pathinfo($file, PATHINFO_EXTENSION)] ?? 'application/octet-stream'));
    readfile($file);

    return;
}

if ($method === 'GET' && $path === '/api/products') {
    $json(array_map(static fn(string $id, array $p): array => ['id' => $id, 'name' => $p['name'], 'price' => $p['price']], array_keys(PRODUCTS), PRODUCTS));

    return;
}

// Step 1: the buyer clicked "Pay with escrow"
if ($method === 'POST' && $path === '/checkout') {
    $product = PRODUCTS[$_POST['product'] ?? ''] ?? null;
    if ($product === null) {
        http_response_code(404);

        return;
    }
    $email = (string) ($_POST['email'] ?? '');
    $order = ['id' => bin2hex(random_bytes(16)), 'product' => $product['name'], 'buyer' => $email, 'status' => 'awaiting_payment', 'escrow_id' => null, 'webhooks' => []];
    $session = $ketapay->checkoutSessions->create([
        'amount' => $product['price'], // kobo
        'category' => 'goods',
        'title' => $product['name'],
        'description' => $product['description'],
        'buyer' => ['email' => $email],
        // No `seller`: the shop sells this itself and is paid into its KetaPay balance
        'external_reference' => $order['id'],
        'return_url' => "$baseUrl/order.html?order={$order['id']}",
    ]);
    $save($order);
    header('Location: ' . $session->url, true, 303);

    return;
}

// Step 3: KetaPay tells the shop what happened. Read the raw body: the signature covers it exactly.
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

// The shop admin's list, newest first
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
    // The "what's happening" panel: the escrow as KetaPay has it, and the webhooks this server received
    $escrow = $order['escrow_id'] !== null ? $ketapay->escrows->retrieve($order['escrow_id'])->toArray() : null;
    $json(['escrow' => $escrow, 'webhooks' => $order['webhooks']]);

    return;
}

// Step 4: the shop sent it. As the seller, its key alone marks the milestone delivered; the buyer
// is then asked to confirm, and that pays the shop.
if ($method === 'POST' && preg_match('#^/orders/([^/]+)/ship$#', $path, $m)) {
    $order = $orders()[$m[1]] ?? null;
    if ($order === null || $order['status'] !== 'paid') {
        $json(['error' => 'Only a paid order can be shipped.'], 409);

        return;
    }
    $escrow = $ketapay->escrows->retrieve($order['escrow_id']);
    $ketapay->escrows->milestones->deliver($escrow->id, $escrow->milestones[0]->id, ['note' => 'Shipped with GIG Logistics']);
    $json($summary($save(['status' => 'shipped'] + $order)));

    return;
}

http_response_code(404);
