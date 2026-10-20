# Shop checkout

A one-page shop that sells its own goods and takes **escrow as a way to pay**. The buyer pays, KetaPay
holds the money, the shop ships, and the shop is paid when the buyer confirms the lamp arrived.

Because the shop sells its own goods, the checkout session has **no `seller`**: your business is the
seller. Releases are paid into your KetaPay balance, and you withdraw them from the dashboard's Payouts.

```
public/   the shop page and the order page (shared by both versions)
node/     the shop's server in Node (Express), using @ketapay/node from npm
php/      the same server in PHP, using ketapay/ketapay-php from Packagist
```

## What the server does

| Route | What happens |
| --- | --- |
| `POST /checkout` | Creates a checkout session with no `seller` and sends the buyer to KetaPay's checkout page |
| `POST /webhooks` | Verifies KetaPay's signature, then marks the order paid (`escrow.funded`), done (`escrow.completed`) or refunded (`escrow.refunded`) |
| `GET /orders/{id}` | The order, for the order page |
| `POST /orders/{id}/ship` | Marks the milestone delivered. As the seller, your key alone does it; the buyer is then asked to confirm |

## Run it

1. Copy `.env.example` to `.env` and add your `sk_test_` key.
2. Start one version:

   ```sh
   cd node && npm install && npm start
   # or
   cd php && composer install && composer start
   ```

3. Open http://localhost:4242 and pay with a test card from the checkout page.

## Receive webhooks

KetaPay has to reach `/webhooks`, which `localhost` isn't. Expose port 4242 with a tunnel (for example
`cloudflared tunnel --url http://localhost:4242`), or in Codespaces make the port public. Then in the
dashboard under **Developers → Webhooks**, add `https://<your address>/webhooks` with the events
`escrow.funded`, `escrow.completed` and `escrow.refunded`, and put its signing secret in `.env` as
`KETAPAY_WEBHOOK_SECRET`. Set `BASE_URL` to the same address so the buyer comes back to it after paying.

## Try the whole flow

1. Pay for the lamp. Back on the order page it says **paid** once `escrow.funded` arrives.
2. Click **Mark as shipped** (in a real shop this lives in your admin).
3. Confirm delivery as the buyer from KetaPay's email (in test mode the code is `123456`). The order
   becomes **completed** and the sale is in your balance on the dashboard's Payouts.

Orders are kept in memory (Node) or a JSON file (PHP). Use your own database in a real shop.
