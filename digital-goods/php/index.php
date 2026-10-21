<?php

// Pagebound: a store selling its own e-books and courses, with KetaPay escrow as a way to pay.
// Delivery is instant: when KetaPay says the buyer has paid, the store delivers by itself, and the
// buyer confirms the download works, which pays the store. The same routes as ../node:
//
// 1. POST /checkout                         a checkout session with no `seller`: the store is the seller
// 2. KetaPay's checkout page                the buyer pays; KetaPay holds the money
// 3. POST /webhooks                         escrow.funded: the store delivers at once, with its key alone
// 4. GET /orders/{id}/download              the buyer downloads it, from the order page
// 5. POST /orders/{id}/buyer/code|confirm   the buyer confirms it works with a one-time code: the store is paid
//
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
    exit('Set KETAPAY_SECRET_KEY to your sk_test_ key in digital-goods/.env (see .env.example).');
}
$ketapay = new KetaPay(array_filter(['apiKey' => $env('KETAPAY_SECRET_KEY'), 'baseUrl' => $env('KETAPAY_BASE_URL')]));
$baseUrl = $env('BASE_URL', 'http://localhost:4242');

const PRODUCTS = [
    'ebook-cooking' => [
        'name' => 'Jollof & Beyond (e-book)',
        'price' => 450_000, // kobo: ₦4,500
        'description' => '120-page e-book of West African recipes, PDF and EPUB, with a printable shopping list.',
        'file' => "Jollof & Beyond\n\nChapter 1: The perfect party jollof…\n",
    ],
    'course-excel' => [
        'name' => 'Excel for small businesses (video course)',
        'price' => 2_500_000,
        'description' => 'Eight video lessons, three hours in all: bookkeeping, stock and payroll sheets, with templates.',
        'file' => "Excel for small businesses\n\nLesson 1: Setting up your bookkeeping sheet…\n",
    ],
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
$json = static function (mixed $body, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($body);
};
$input = static fn(): array => json_decode((string) file_get_contents('php://input'), true) ?: [];

$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';

// Pagebound's pages, shared with the Node version
$file = realpath(__DIR__ . '/../public' . ($path === '/' ? '/index.html' : $path));
if ($method === 'GET' && $file !== false && str_starts_with($file, realpath(__DIR__ . '/../public')) && is_file($file)) {
    $types = ['html' => 'text/html', 'css' => 'text/css', 'js' => 'text/javascript'];
    header('Content-Type: ' . ($types[pathinfo($file, PATHINFO_EXTENSION)] ?? 'application/octet-stream'));
    readfile($file);

    return;
}

try {
    if ($method === 'GET' && $path === '/api/products') {
        $json(array_map(static fn(string $id, array $p): array => ['id' => $id, 'name' => $p['name'], 'price' => $p['price']], array_keys(PRODUCTS), PRODUCTS));

        return;
    }

    // Step 1: the buyer clicked "Pay with escrow"
    if ($method === 'POST' && $path === '/checkout') {
        $isJson = str_contains($_SERVER['CONTENT_TYPE'] ?? '', 'application/json');
        $form = $isJson ? $input() : $_POST;
        $id = (string) ($form['product'] ?? '');
        $product = PRODUCTS[$id] ?? null;
        if ($product === null) {
            http_response_code(404);

            return;
        }
        $email = (string) ($form['email'] ?? '');
        $order = ['id' => bin2hex(random_bytes(16)), 'product' => $id, 'buyer' => $email, 'status' => 'awaiting_payment', 'escrow_id' => null, 'webhooks' => []];
        $session = $ketapay->checkoutSessions->create([
            'amount' => $product['price'],
            'category' => 'digital',
            'title' => $product['name'],
            'description' => $product['description'],
            'buyer' => ['email' => $email],
            // No `seller`: the store sells this itself and is paid into its KetaPay balance
            'external_reference' => $order['id'],
            'return_url' => "$baseUrl/order.html?order={$order['id']}",
        ]);
        $save($order);
        if ($isJson) {
            // A JSON post ("Pay on this page", @ketapay/checkout) gets the url back to open over the page
            $json(['url' => $session->url, 'return_url' => $session->return_url]);

            return;
        }
        header('Location: ' . $session->url, true, 303);

        return;
    }

    // Step 3: KetaPay tells the store the buyer paid, and the store delivers at once. Webhooks can
    // arrive more than once, so delivery happens only for an order that isn't delivered yet.
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
            if ($event->type === 'escrow.funded' && $order['status'] === 'awaiting_payment') {
                // The store is the seller, so its key alone marks it delivered. If this fails, the order
                // stays unpaid here and KetaPay's retry delivers it.
                $ketapay->escrows->milestones->deliver($escrow->id, $escrow->milestones[0]->id, [
                    'note' => mb_substr('Download ready: ' . PRODUCTS[$order['product']]['name'], 0, 160),
                ]);
                $order = ['status' => 'delivered', 'escrow_id' => $escrow->id] + $order;
            }
            $order = match ($event->type) {
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

    if ($method === 'GET' && preg_match('#^/orders/([^/]+)(/activity|/download)?$#', $path, $m)) {
        $order = $orders()[$m[1]] ?? null;
        if ($order === null) {
            http_response_code(404);

            return;
        }
        $part = $m[2] ?? '';
        if ($part === '') {
            $json(['id' => $order['id'], 'product' => PRODUCTS[$order['product']]['name'], 'status' => $order['status']]);
        } elseif ($part === '/download') {
            // Step 4: the download, only once paid and never after a refund
            if (!in_array($order['status'], ['delivered', 'completed'], true)) {
                http_response_code(403);

                return;
            }
            header('Content-Type: text/plain');
            header("Content-Disposition: attachment; filename=\"{$order['product']}.txt\"");
            echo PRODUCTS[$order['product']]['file'];
        } else {
            // The "what's happening" panel: the escrow as KetaPay has it, and the webhooks the store received
            $escrow = $order['escrow_id'] !== null ? $ketapay->escrows->retrieve($order['escrow_id'])->toArray() : null;
            $json(['escrow' => $escrow, 'webhooks' => $order['webhooks']]);
        }

        return;
    }

    // Step 5: the buyer confirms the download works, approved with a one-time code (123456 in test mode)
    if ($method === 'POST' && preg_match('#^/orders/([^/]+)/buyer/(code|confirm)$#', $path, $m)) {
        $order = $orders()[$m[1]] ?? null;
        if ($order === null) {
            http_response_code(404);

            return;
        }
        if ($m[2] === 'code') {
            $json(['session_id' => $ketapay->customerSessions->create(['email' => $order['buyer']])->id]);

            return;
        }
        $body = $input();
        $token = (string) $ketapay->customerSessions->verify((string) ($body['session_id'] ?? ''), (string) ($body['code'] ?? ''))->token;
        $escrow = $ketapay->escrows->retrieve((string) $order['escrow_id']);
        $ketapay->escrows->milestones->release($escrow->id, $escrow->milestones[0]->id, [], ['customerToken' => $token]);
        $order = $save(['status' => 'completed'] + $order);
        $json(['id' => $order['id'], 'status' => $order['status']]);

        return;
    }

    http_response_code(404);
} catch (KetaPayError $e) {
    $json(['error' => $e->getMessage(), 'code' => $e->code], $e->statusCode ?? 400);
}
