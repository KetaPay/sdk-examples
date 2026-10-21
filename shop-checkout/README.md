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
| Buyer | The shop's catalog, then KetaPay's checkout (its page, or over the shop's), then their order page. KetaPay emails them to confirm delivery. |
| Shop owner | The admin page: orders, a **Ship** button, and the "what's happening" panel. The money lands in the KetaPay balance. |
| KetaPay | Holds the money, collects the buyer's confirmation, pays the shop, runs disputes. |

## What's in it

```
public/index.html    the catalog: three products, "Pay with escrow" or "Pay on this page"
public/pay-here.js   "Pay on this page": the same checkout opened over the page with @ketapay/checkout
public/order.html    the buyer's order, with the "what's happening" panel
public/admin.html    the shop admin: orders, Ship, the panel
node/server.js       the server in Node (Express), using @ketapay/node from npm
php/index.php        the same server in PHP, using ketapay/ketapay-php from Packagist
react/               the catalog in React (Vite), opening the checkout over the page with @ketapay/react
scenarios/           what must hold, run against either server
```

| Route | What happens |
| --- | --- |
| `GET /api/products` | The catalog. Prices live on the server, never in the browser. |
| `POST /checkout` | A checkout session with no `seller`. A form post is redirected to KetaPay's checkout page; a JSON post gets `{ url, return_url }` back, for "Pay on this page" and the React version |
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

### Checkout over your page

Instead of sending the buyer away, the browser libraries open KetaPay's checkout over the shop. The server
is the same: it still creates the session with your secret key and learns about the payment from
`escrow.funded`. `onSuccess` only moves the page along; it never marks an order paid.

- **No build step:** click **Pay on this page** on any product. The page loads `@ketapay/checkout` from
  `https://js.ketapay.com/v1/checkout.js`, and `public/pay-here.js` posts the same form as JSON and calls
  `KetaPay.open({ url })` with the url that comes back.
- **React:** with a server running on 4242,

  ```sh
  cd react && npm install && npm run dev
  ```

  and open http://localhost:5173. `<KetaPayButton url={createCheckout}>` asks the server for the url when it
  is clicked. Vite forwards the API, order and admin pages to port 4242, so the browser sees one origin.

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
6. A JSON checkout gets the session's `url` back, for the browser libraries to open over the page.
