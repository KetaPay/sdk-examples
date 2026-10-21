# Digital goods: instant delivery, paid when it works

**Pagebound** sells its own e-books and online courses. Digital goods arrive instantly, but buyers still
take a risk: the file might not open, a licence key might be used already, a course might not be what
was described. And Pagebound is a small store most buyers have never heard of.

So Pagebound takes **escrow as a way to pay**. The buyer pays KetaPay. The moment the payment lands,
Pagebound delivers by itself: the download appears on the buyer's order page. The buyer opens it,
checks it's what was described, and confirms. That pays Pagebound.

Digital goods here means anything delivered online: e-books, courses, software and licence keys,
templates, music, stock photos, memberships. (Not crypto, gift cards or airtime.)

## How the money moves

```
Buyer pays ₦4,500 + KetaPay's buyer fee ──▶ KetaPay holds ₦4,500
escrow.funded webhook ──▶ Pagebound delivers at once (its key alone: it is the seller)
                      ──▶ the download unlocks on the order page
Buyer confirms it works (one-time code) ──▶ ₦4,500 less KetaPay's seller fee ──▶ Pagebound's balance
It doesn't work ──▶ the buyer reports it to KetaPay instead; a refund turns the download off
```

Because the checkout has **no `seller`**, Pagebound is the seller, the same as in
[shop-checkout](../shop-checkout). The difference is that delivery happens in the webhook, with no person
involved. So the webhook handler has to be safe to run twice: KetaPay retries a delivery until it's
answered, and the same event can arrive again.

## What's in it

```
public/index.html    the store: an e-book and a course, "Pay with escrow"
public/order.html    the buyer's order: the download, "Does it work?", the "what's happening" panel
node/server.js       the server in Node (Express), using @ketapay/node from npm
php/index.php        the same server in PHP, using ketapay/ketapay-php from Packagist
scenarios/           what must hold, run against either server
```

| Route | What happens |
| --- | --- |
| `POST /checkout` | A checkout session with `category: digital` and no `seller`, then a redirect to pay |
| `POST /webhooks` | `escrow.funded`: delivers the milestone with the key alone, once, however often it arrives. `escrow.completed` and `escrow.refunded` update the order |
| `GET /orders/{id}/download` | The file, only once delivered and never after a refund |
| `POST /orders/{id}/buyer/code`, `/confirm` | The buyer confirms it works with a one-time code: the milestone is released with their token |
| `GET /orders/{id}`, `/orders/{id}/activity` | The order and the panel |

## Run it

1. Copy `.env.example` to `.env` and add your `sk_test_` key.
2. `cd node && npm install && npm start`, or `cd php && composer install && composer start`.
3. Open http://localhost:4242, buy the e-book with a test card, download it, and confirm with `123456`.

This example needs webhooks to deliver. Locally, expose port 4242 over https (`cloudflared tunnel --url
http://localhost:4242`, or a public Codespaces port), add `https://<your address>/webhooks` under
**Developers → Webhooks** with `escrow.funded`, `escrow.completed` and `escrow.refunded`, put its signing
secret in `.env`, and set `BASE_URL` to the same address.

## Scenarios

```sh
cd ../tools && npm install && npm run scenarios -- digital-goods node   # or php
```

1. Payment lands, the store delivers by itself, the buyer downloads it and confirms, and the store is paid.
2. The same `escrow.funded` twice delivers once, and both copies are answered 200.
3. A refund turns the download off.
4. A forged `escrow.funded` delivers nothing and unlocks no download.
5. A wrong code when confirming is refused and the store is not paid.
