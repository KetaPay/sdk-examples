<?php

// Keyhaus: a property agency. A buyer pays for a flat through KetaPay in three stages (deposit,
// documents, keys); the owner is paid each stage only when the buyer accepts it, and Keyhaus takes a
// capped commission on the sale. The same routes as ../node:
//
// 1. POST /listings/{id}/buy               checkout session: three milestones, the title documents
//                                          attached, the owner as seller, a capped commission
// 2. KetaPay's checkout page               the buyer pays the whole price (a bank transfer, for most)
// 3. POST /sales/{id}/owner/code|deliver   the owner hands over the current stage, with its document
// 4. POST /sales/{id}/buyer/code|accept    the buyer accepts it: the owner is paid for that stage
// 5. POST /webhooks                        keeps the sale in step with KetaPay
//
// Run: composer start (PHP's built-in server, with this file as the router)

declare(strict_types=1);

require __DIR__ . '/vendor/autoload.php';

use KetaPay\Errors\KetaPayError;
use KetaPay\Errors\WebhookSignatureError;
use KetaPay\KetaPay;
use KetaPay\Models\Escrow;

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
    exit('Set KETAPAY_SECRET_KEY to your sk_test_ key in property/.env (see .env.example).');
}
$ketapay = new KetaPay(array_filter(['apiKey' => $env('KETAPAY_SECRET_KEY'), 'baseUrl' => $env('KETAPAY_BASE_URL')]));
$baseUrl = $env('BASE_URL', 'http://localhost:4242');

// Your database. A JSON file here, since PHP starts fresh on every request.
const LISTINGS = [
    'lekki-3-bed' => [
        'title' => '3-bedroom flat, Lekki Phase 1',
        'description' => "Third-floor 3-bedroom flat with Governor's Consent, 24-hour power, two parking spaces and a pool. "
            . 'Sold with the deed of assignment and survey plan; no outstanding service charge.',
        'price' => 8_500_000_000, // kobo: ₦85,000,000
        'owner' => ['email' => 'owner.adeyemi@example.com', 'name' => 'Funke Adeyemi'],
        // What the buyer agrees to, kept on the escrow: KetaPay records each file's fingerprint
        'documents' => [['name' => 'Survey plan.pdf', 'url' => 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf']],
        'stages' => [
            ['title' => 'Deposit', 'description' => 'Offer accepted and the sale agreement signed', 'share' => 0.1],
            ['title' => 'Documents', 'description' => "Deed of assignment and survey plan handed to the buyer's lawyer", 'share' => 0.6],
            ['title' => 'Keys', 'description' => 'Keys handed over and the buyer takes possession', 'share' => 0.3],
        ],
    ],
];

// The stages in kobo; the last one takes any rounding, so they always add up to the price
function plan(array $listing): array
{
    $amounts = array_map(static fn(array $s): int => (int) round($listing['price'] * $s['share']), $listing['stages']);
    $amounts[count($amounts) - 1] = $listing['price'] - array_sum(array_slice($amounts, 0, -1));

    return array_map(static fn(array $s, int $amount): array => ['title' => $s['title'], 'description' => $s['description'], 'amount' => $amount], $listing['stages'], $amounts);
}

$store = __DIR__ . '/var/sales.json';
$sales = static fn(): array => is_file($store) ? json_decode((string) file_get_contents($store), true) : [];
$save = static function (array $sale) use ($store, $sales): array {
    @mkdir(dirname($store));
    $all = $sales();
    $all[$sale['id']] = $sale;
    file_put_contents($store, json_encode($all), LOCK_EX);

    return $sale;
};
$json = static function (mixed $body, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($body);
};
$input = static fn(): array => json_decode((string) file_get_contents('php://input'), true) ?: [];
$view = static fn(array $sale, ?Escrow $escrow): array => [
    'id' => $sale['id'],
    'title' => $sale['title'],
    'status' => $escrow?->status ?? $sale['status'],
    'commission' => $sale['commission'],
    'milestones' => array_map(static fn($m): array => [
        'id' => $m->id,
        'title' => $m->title,
        'amount' => $m->amount,
        'status' => $m->status,
        'delivery' => $m->delivery?->toArray(),
    ], $escrow?->milestones ?? []),
];

$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';

// Keyhaus's pages, shared with the Node version
$file = realpath(__DIR__ . '/../public' . ($path === '/' ? '/index.html' : $path));
if ($method === 'GET' && $file !== false && str_starts_with($file, realpath(__DIR__ . '/../public')) && is_file($file)) {
    $types = ['html' => 'text/html', 'css' => 'text/css', 'js' => 'text/javascript'];
    header('Content-Type: ' . ($types[pathinfo($file, PATHINFO_EXTENSION)] ?? 'application/octet-stream'));
    readfile($file);

    return;
}

try {
    if ($method === 'GET' && preg_match('#^/api/listings/([^/]+)$#', $path, $m)) {
        $l = LISTINGS[$m[1]] ?? null;
        $l === null ? http_response_code(404) : $json(['id' => $m[1], 'title' => $l['title'], 'description' => $l['description'], 'price' => $l['price'], 'owner' => $l['owner']['name'], 'stages' => plan($l)]);

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
        $sale = ['id' => bin2hex(random_bytes(16)), 'title' => $listing['title'], 'status' => 'awaiting_payment', 'escrow_id' => null, 'webhooks' => []];
        $session = $ketapay->checkoutSessions->create([
            'amount' => $listing['price'],
            'category' => 'property',
            'title' => $listing['title'],
            'description' => $listing['description'],
            'attachments' => $listing['documents'],
            'milestones' => plan($listing),
            'buyer' => ['email' => $email],
            'seller' => $listing['owner'],
            // Keyhaus's fee: a share of the price, never more than the cap, taken from the owner's side
            'commission' => ['rate_bps' => (int) $env('COMMISSION_BPS', '250'), 'max_amount' => (int) $env('COMMISSION_MAX', '50000000')],
            'external_reference' => $sale['id'],
            'return_url' => "$baseUrl/buyer.html?sale={$sale['id']}",
        ]);
        $save($sale + ['buyer' => $email, 'owner' => $listing['owner']['email'], 'commission' => $session->fees->commission]);
        if ($isJson) {
            // A JSON post ("Pay on this page", @ketapay/checkout) gets the url back to open over the page
            $json(['url' => $session->url, 'return_url' => $session->return_url]);

            return;
        }
        header('Location: ' . $session->url, true, 303);

        return;
    }

    // KetaPay emails the owner or the buyer a one-time code; the token from it lasts 15 minutes
    if ($method === 'POST' && preg_match('#^/sales/([^/]+)/(owner|buyer)/code$#', $path, $m)) {
        $sale = $sales()[$m[1]] ?? null;
        if ($sale === null) {
            http_response_code(404);

            return;
        }
        $json(['session_id' => $ketapay->customerSessions->create(['email' => $sale[$m[2]]])->id]);

        return;
    }

    // Steps 3 and 4: the owner hands over the current stage; the buyer accepts it, which pays the owner
    if ($method === 'POST' && preg_match('#^/sales/([^/]+)/(owner/deliver|buyer/accept)$#', $path, $m)) {
        $sale = $sales()[$m[1]] ?? null;
        if ($sale === null || $sale['escrow_id'] === null) {
            http_response_code(404);

            return;
        }
        $body = $input();
        $token = (string) $ketapay->customerSessions->verify((string) ($body['session_id'] ?? ''), (string) ($body['code'] ?? ''))->token;
        $milestoneId = (string) ($body['milestone_id'] ?? '');
        if ($m[2] === 'owner/deliver') {
            $link = (string) ($body['link'] ?? '');
            $escrow = $ketapay->escrows->milestones->deliver(
                $sale['escrow_id'],
                $milestoneId,
                ['note' => (string) ($body['note'] ?? ''), 'attachments' => $link !== '' ? [['url' => $link]] : []],
                ['customerToken' => $token],
            );
        } else {
            $escrow = $ketapay->escrows->milestones->release($sale['escrow_id'], $milestoneId, [], ['customerToken' => $token]);
        }
        $json($view($sale, $escrow));

        return;
    }

    // The agency admin's list, newest first, with the commission each sale earns
    if ($method === 'GET' && $path === '/sales') {
        $json(array_map(static fn(array $s): array => array_intersect_key($s, array_flip(['id', 'title', 'status', 'commission'])), array_reverse(array_values($sales()))));

        return;
    }

    // One sale, and the "what's happening" panel: the escrow as KetaPay has it, and the webhooks received
    if ($method === 'GET' && preg_match('#^/sales/([^/]+)(/activity)?$#', $path, $m)) {
        $sale = $sales()[$m[1]] ?? null;
        if ($sale === null) {
            http_response_code(404);

            return;
        }
        $escrow = $sale['escrow_id'] !== null ? $ketapay->escrows->retrieve($sale['escrow_id']) : null;
        $json(isset($m[2]) ? ['escrow' => $escrow?->toArray(), 'webhooks' => $sale['webhooks']] : $view($sale, $escrow));

        return;
    }

    // Step 5: KetaPay tells Keyhaus what happened. Read the raw body: the signature covers it exactly.
    if ($method === 'POST' && $path === '/webhooks') {
        try {
            $event = $ketapay->webhooks->verify((string) file_get_contents('php://input'), $_SERVER['HTTP_KETAPAY_SIGNATURE'] ?? null, (string) $env('KETAPAY_WEBHOOK_SECRET'));
        } catch (WebhookSignatureError $e) {
            error_log('Refused a webhook: ' . $e->getMessage());
            http_response_code(400);

            return;
        }
        $escrow = $event->data->object;
        $sale = $sales()[$escrow->external_reference ?? ''] ?? null;
        if ($sale !== null) {
            $sale['webhooks'][] = ['type' => $event->type, 'received_at' => gmdate('Y-m-d\TH:i:s\Z')];
            $save($event->type === 'escrow.funded' ? ['status' => 'funded', 'escrow_id' => $escrow->id] + $sale : $sale);
            error_log("{$event->type}: sale {$sale['id']}");
        }
        http_response_code(200);

        return;
    }

    http_response_code(404);
} catch (KetaPayError $e) {
    // A wrong code or a stage out of order comes back as a KetaPay error with a message to show
    $json(['error' => $e->getMessage(), 'code' => $e->code], $e->statusCode ?? 400);
}
