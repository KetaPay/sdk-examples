<?php

// Gigline: a freelance platform. A client pays for a project up front in stages (milestones), KetaPay
// holds the money, and each stage is paid to the freelancer only when the client accepts it. The same
// routes as ../node:
//
// 1. POST /projects                                checkout session with the plan: Design, Build, Launch
// 2. KetaPay's page                                the client pays for the whole project
// 3. POST /projects/{id}/freelancer/code|deliver   the freelancer delivers the current stage, with a note and a file
// 4. POST /projects/{id}/client/code|release       the client accepts it: that stage is paid
// 5. GET /projects/{id}                            the stages as KetaPay has them
//
// Stages move in order: only the first one not yet paid can be delivered or accepted.
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
    exit('Set KETAPAY_SECRET_KEY to your sk_test_ key in freelance-milestones/.env (see .env.example).');
}
$ketapay = new KetaPay(array_filter(['apiKey' => $env('KETAPAY_SECRET_KEY'), 'baseUrl' => $env('KETAPAY_BASE_URL')]));
$baseUrl = $env('BASE_URL', 'http://localhost:4242');

// Your database. A JSON file here, since PHP starts fresh on every request.
$store = __DIR__ . '/var/projects.json';
$projects = static fn(): array => is_file($store) ? json_decode((string) file_get_contents($store), true) : [];
$save = static function (array $project) use ($store, $projects): array {
    @mkdir(dirname($store));
    $all = $projects();
    $all[$project['id']] = $project;
    file_put_contents($store, json_encode($all), LOCK_EX);

    return $project;
};
$json = static function (mixed $body, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($body);
};
$input = static fn(): array => json_decode((string) file_get_contents('php://input'), true) ?: [];
// The stages come from KetaPay, so the page always shows what really happened
$view = static fn(array $project, ?Escrow $escrow): array => [
    'id' => $project['id'],
    'status' => $escrow?->status ?? $project['status'],
    'milestones' => array_map(static fn($m): array => [
        'id' => $m->id,
        'title' => $m->title,
        'status' => $m->status,
        'delivery' => $m->delivery?->toArray(),
    ], $escrow?->milestones ?? []),
];

$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';

// Gigline's pages, shared with the Node version
$file = realpath(__DIR__ . '/../public' . ($path === '/' ? '/index.html' : $path));
if ($method === 'GET' && $file !== false && str_starts_with($file, realpath(__DIR__ . '/../public')) && is_file($file)) {
    $types = ['html' => 'text/html', 'css' => 'text/css', 'js' => 'text/javascript'];
    header('Content-Type: ' . ($types[pathinfo($file, PATHINFO_EXTENSION)] ?? 'application/octet-stream'));
    readfile($file);

    return;
}

try {
    // Step 1: the client funds the project
    if ($method === 'POST' && $path === '/projects') {
        $project = ['id' => bin2hex(random_bytes(16)), 'status' => 'awaiting_payment', 'escrow_id' => null, 'webhooks' => []];
        $session = $ketapay->checkoutSessions->create([
            'amount' => 200_000_000, // kobo: ₦2,000,000, the sum of the stages
            'category' => 'services',
            'title' => 'Company website',
            'description' => 'Five-page marketing site: design, build on Next.js, and launch on the client domain.',
            'milestones' => [
                ['title' => 'Design', 'description' => 'Homepage and four inner pages in Figma', 'amount' => 40_000_000],
                ['title' => 'Build', 'description' => 'All five pages built and responsive', 'amount' => 110_000_000],
                ['title' => 'Launch', 'description' => 'Live on the client domain with analytics', 'amount' => 50_000_000],
            ],
            'buyer' => ['email' => (string) ($_POST['client'] ?? '')],
            'seller' => ['email' => (string) ($_POST['freelancer'] ?? '')],
            'external_reference' => $project['id'],
            'return_url' => "$baseUrl/client.html?project={$project['id']}",
        ]);
        $save($project + ['client' => (string) $_POST['client'], 'freelancer' => (string) $_POST['freelancer']]);
        header('Location: ' . $session->url, true, 303);

        return;
    }

    // KetaPay emails the freelancer or the client a one-time code. Their token from it lasts 15 minutes.
    if ($method === 'POST' && preg_match('#^/projects/([^/]+)/(freelancer|client)/code$#', $path, $m)) {
        $project = $projects()[$m[1]] ?? null;
        if ($project === null) {
            http_response_code(404);

            return;
        }
        $json(['session_id' => $ketapay->customerSessions->create(['email' => $project[$m[2]]])->id]);

        return;
    }

    // Step 3: the freelancer delivers the current stage. KetaPay fetches a file link once and records its
    // fingerprint (type, size, SHA-256), so a file swapped later is caught (PDF, image, Word or Excel, up to 25 MB).
    if ($method === 'POST' && preg_match('#^/projects/([^/]+)/freelancer/deliver$#', $path, $m)) {
        $project = $projects()[$m[1]] ?? null;
        if ($project === null || $project['escrow_id'] === null) {
            http_response_code(404);

            return;
        }
        $body = $input();
        $token = (string) $ketapay->customerSessions->verify((string) ($body['session_id'] ?? ''), (string) ($body['code'] ?? ''))->token;
        $link = (string) ($body['link'] ?? '');
        $escrow = $ketapay->escrows->milestones->deliver(
            $project['escrow_id'],
            (string) ($body['milestone_id'] ?? ''),
            ['note' => (string) ($body['note'] ?? ''), 'attachments' => $link !== '' ? [['url' => $link]] : []],
            ['customerToken' => $token],
        );
        $json($view($project, $escrow));

        return;
    }

    // Step 4: the client accepts the current stage, which pays the freelancer for it
    if ($method === 'POST' && preg_match('#^/projects/([^/]+)/client/release$#', $path, $m)) {
        $project = $projects()[$m[1]] ?? null;
        if ($project === null || $project['escrow_id'] === null) {
            http_response_code(404);

            return;
        }
        $body = $input();
        $token = (string) $ketapay->customerSessions->verify((string) ($body['session_id'] ?? ''), (string) ($body['code'] ?? ''))->token;
        $escrow = $ketapay->escrows->milestones->release($project['escrow_id'], (string) ($body['milestone_id'] ?? ''), [], ['customerToken' => $token]);
        $json($view($project, $escrow));

        return;
    }

    // Step 5, and the "what's happening" panel: the escrow as KetaPay has it, and the webhooks received
    if ($method === 'GET' && preg_match('#^/projects/([^/]+)(/activity)?$#', $path, $m)) {
        $project = $projects()[$m[1]] ?? null;
        if ($project === null) {
            http_response_code(404);

            return;
        }
        $escrow = $project['escrow_id'] !== null ? $ketapay->escrows->retrieve($project['escrow_id']) : null;
        $json(isset($m[2]) ? ['escrow' => $escrow?->toArray(), 'webhooks' => $project['webhooks']] : $view($project, $escrow));

        return;
    }

    // KetaPay tells you when the project is paid for, and when each stage moves
    if ($method === 'POST' && $path === '/webhooks') {
        try {
            $event = $ketapay->webhooks->verify((string) file_get_contents('php://input'), $_SERVER['HTTP_KETAPAY_SIGNATURE'] ?? null, (string) $env('KETAPAY_WEBHOOK_SECRET'));
        } catch (WebhookSignatureError $e) {
            error_log('Refused a webhook: ' . $e->getMessage());
            http_response_code(400);

            return;
        }
        $escrow = $event->data->object;
        $project = $projects()[$escrow->external_reference ?? ''] ?? null;
        if ($project !== null) {
            $project['webhooks'][] = ['type' => $event->type, 'received_at' => gmdate('Y-m-d\TH:i:s\Z')];
            $save($event->type === 'escrow.funded' ? ['status' => 'funded', 'escrow_id' => $escrow->id] + $project : $project);
            error_log("{$event->type}: project {$project['id']}");
        }
        http_response_code(200);

        return;
    }

    http_response_code(404);
} catch (KetaPayError $e) {
    // A wrong code or a stage out of order comes back as a KetaPay error with a message to show
    $json(['error' => $e->getMessage(), 'code' => $e->code], $e->statusCode ?? 400);
}
