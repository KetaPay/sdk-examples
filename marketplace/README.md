# Marketplace

A marketplace where your customers **buy from and sell to each other**, with KetaPay holding the money
and your platform taking a **commission** on each sale. Think classifieds, second-hand phones, or any
listing site where you never touch the goods.

Your secret key alone never moves your customers' money. Each step that does (the seller marking it
sent, the buyer confirming it arrived) needs that customer's **token**: KetaPay emails them a one-time
code, they type it on your site, and the token lets you act for them that once. In test mode the code is
always `123456`.

```
public/   the listing page and the order page (shared by both versions)
node/     the marketplace's server in Node (Express), using @ketapay/node from npm
php/      the same server in PHP, using ketapay/ketapay-php from Packagist
```

## What the server does

| Route | What happens |
| --- | --- |
| `POST /listings/{id}/buy` | Creates a checkout session with the buyer, the listing's seller and your commission, and sends the buyer to KetaPay's checkout page |
| `POST /orders/{id}/{seller\|buyer}/code` | KetaPay emails that customer a one-time code |
| `POST /orders/{id}/seller/confirm` | The seller's code checks out: marks the phone sent |
| `POST /orders/{id}/buyer/confirm` | The buyer's code checks out: confirms it arrived and pays the seller, less your commission |
| `POST /webhooks` | Verifies KetaPay's signature and keeps the order in step (`escrow.funded`, `milestone.delivered`, `escrow.completed`, `escrow.refunded`) |
| `GET /orders/{id}` | The order, for the order page |

## Run it

1. Copy `.env.example` to `.env`, add your `sk_test_` key, and set `COMMISSION_BPS` within the rate in
   your KetaPay agreement (a higher one is refused with `commission_exceeds_contract`).
2. Start one version:

   ```sh
   cd node && npm install && npm start
   # or
   cd php && composer install && composer start
   ```

3. Open http://localhost:4242, buy the phone and pay with a test card.

For webhooks, expose port 4242 (a tunnel, or a public Codespaces port), add
`https://<your address>/webhooks` under **Developers → Webhooks** with the events above, and put its
signing secret in `.env`.

## Try the whole flow

1. Buy the phone and pay. The order page says **paid**.
2. As the seller: **Send code**, enter `123456`, **Confirm**. The order is **shipped**.
3. As the buyer: **Send code**, enter `123456`, **Confirm**. The order is **completed**: the seller is
   paid and your commission is in your balance on the dashboard's Payouts.

A wrong code is refused with KetaPay's message, and nothing moves. In a real marketplace the seller and
buyer each see only their own step, after signing in to your site.
