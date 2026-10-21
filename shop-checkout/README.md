# Shop checkout: a business selling its own goods

**Ade Gadgets** sells lamps, kettles and headphones online. New customers don't know it yet and are wary
of paying a shop they've never heard of, so Ade offers **escrow as a way to pay**: the buyer's money
goes to KetaPay, not to the shop, and the shop is paid only when the buyer confirms the order arrived
as described.

Because Ade sells its own goods, the checkout session has **no `seller`**: the business is the seller.

## How the money moves

```
Buyer pays ₦25,000 + KetaPay's buyer fee ──▶ KetaPay holds ₦25,000
Shop ships, marks it delivered (its key alone)
Buyer confirms with KetaPay ──▶ ₦25,000 less KetaPay's seller fee ──▶ Ade's KetaPay balance ──▶ Payouts
Buyer reports a problem instead ──▶ KetaPay runs the dispute; the buyer can get it all back
```

| Who | What they see |
| --- | --- |
| Buyer | The shop's catalog, then KetaPay's checkout page, then their order page. KetaPay emails them to confirm delivery. |
| Shop owner | The admin page: orders, a **Ship** button, and the "what's happening" panel. The money lands in the KetaPay balance. |
| KetaPay | Holds the money, collects the buyer's confirmation, pays the shop, runs disputes. |

## What's in it

```
public/index.html    the catalog: three products, "Pay with escrow"
public/order.html    the buyer's order, with the "what's happening" panel
public/admin.html    the shop admin: orders, Ship, the panel
node/server.js       the server in Node (Express), using @ketapay/node from npm
php/index.php        the same server in PHP, using ketapay/ketapay-php from Packagist
scenarios/           what must hold, run against either server
```

| Route | What happens |
| --- | --- |
| `GET /api/products` | The catalog. Prices live on the server, never in the browser. |
| `POST /checkout` | A checkout session with no `seller`, then a redirect to KetaPay's checkout page |
| `POST /webhooks` | Verifies KetaPay's signature; `escrow.funded` marks the order paid, `escrow.completed` done, `escrow.refunded` refunded |
| `GET /orders`, `GET /orders/{id}` | The admin list and one order |
| `GET /orders/{id}/activity` | The panel: the escrow as KetaPay has it (fees, milestones, timeline) and the webhooks received |
| `POST /orders/{id}/ship` | Marks the milestone delivered with the key alone (the shop is the seller) |

## Run it

1. Copy `.env.example` to `.env` and add your `sk_test_` key.
2. Start one version:

   ```sh
   cd node && npm install && npm start
   # or
   cd php && composer install && composer start
   ```

3. Open http://localhost:4242, buy something and pay with a test card from the checkout page.
4. Open http://localhost:4242/admin.html and **Ship** it. Confirm delivery from KetaPay's email (in test
   mode the code is `123456`).

To receive webhooks locally, expose port 4242 over https (`cloudflared tunnel --url http://localhost:4242`, or
a public Codespaces port), add `https://<your address>/webhooks` under **Developers → Webhooks** with the
events above, put its signing secret in `.env`, and set `BASE_URL` to the same address.

## Scenarios

```sh
cd ../tools && npm install && npm run scenarios -- shop-checkout node   # or php
```

1. A buyer pays, the shop ships with its key, the buyer confirms and the shop is paid.
2. A webhook not signed by KetaPay is refused and changes nothing.
3. An order can't be shipped before KetaPay confirms the payment.
4. A product the shop doesn't sell is refused: prices never come from the browser.
5. `escrow.refunded` marks the order refunded.
