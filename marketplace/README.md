# Marketplace: customers buying from and selling to each other

**Swapmart** is a classifieds site: people list used phones, consoles and bikes, and other people buy
them. Swapmart never holds the goods or the money. It wants buyers to trust strangers, and it earns a
**commission** on every sale.

So every purchase goes through KetaPay escrow. The buyer pays KetaPay, the seller sends the item, and
the buyer confirms it's as described. Only then is the seller paid, less KetaPay's fee and Swapmart's
commission.

## Who can move the money

Swapmart's secret key creates checkouts and reads every sale, but it **can't move a customer's
money on its own**. Each step that does is approved by that customer:

- the seller marks the item sent;
- the buyer confirms it arrived.

KetaPay emails them a one-time code, they type it on Swapmart, and the token it gives lets Swapmart act
for them that once. A leaked Swapmart key can't pay anyone out. In test mode the code is always `123456`.

## How the money moves

```
Buyer pays ₦450,000 + KetaPay's buyer fee ──▶ KetaPay holds ₦450,000
Seller sends it, approves "sent" with a code
Buyer approves "arrived as described" with a code
  ──▶ seller gets ₦450,000 less KetaPay's seller fee and Swapmart's 5% (₦22,500)
  ──▶ Swapmart's ₦22,500 lands in its KetaPay balance
Buyer reports a problem instead ──▶ KetaPay runs the dispute; no commission on money refunded
```

A seller who has never used KetaPay is still paid: KetaPay keeps their money until they sign in with
the same email and verify, then pays it to their bank.

## What's in it

```
public/index.html    listings by three different sellers, "Buy with escrow"
public/order.html    the buyer's purchase: confirm arrival with a code, and the "what's happening" panel
public/seller.html   the seller's sale: mark it sent with a code, and the panel
public/admin.html    Swapmart's admin: every sale, its commission, links to each side's view
node/server.js       the server in Node (Express), using @ketapay/node from npm
php/index.php        the same server in PHP, using ketapay/ketapay-php from Packagist
scenarios/           what must hold, run against either server
```

| Route | What happens |
| --- | --- |
| `GET /api/listings` | The listings. Prices and sellers live on the server. |
| `POST /listings/{id}/buy` | A checkout session with the buyer, the listing's seller and `commission`, then a redirect to KetaPay's checkout page |
| `POST /orders/{id}/{seller\|buyer}/code` | KetaPay emails that customer a one-time code |
| `POST /orders/{id}/seller/confirm` | The seller's code checks out: the milestone is delivered with their token |
| `POST /orders/{id}/buyer/confirm` | The buyer's code checks out: the milestone is released with their token, which pays the seller |
| `POST /webhooks` | Verifies KetaPay's signature and keeps each order in step |
| `GET /orders`, `/orders/{id}`, `/orders/{id}/activity` | The admin list (with commission), one sale, and the panel |

## Run it

1. Copy `.env.example` to `.env`, add your `sk_test_` key, and set `COMMISSION_BPS` within the rate in
   your KetaPay agreement (a higher one is refused with `commission_exceeds_contract`).
2. `cd node && npm install && npm start`, or `cd php && composer install && composer start`.
3. Open http://localhost:4242 and buy something with a test card. From http://localhost:4242/admin.html,
   open the sale as the **seller** to mark it sent, then as the **buyer** to confirm it.

For webhooks locally, expose port 4242 over https, add `https://<your address>/webhooks` under
**Developers → Webhooks**, and put its signing secret in `.env`.

## Scenarios

```sh
cd ../tools && npm install && npm run scenarios -- marketplace node   # or php
```

1. The seller sends it, the buyer confirms, and the seller is paid less the commission, which Swapmart earns.
2. A wrong one-time code is refused with KetaPay's message, and nothing moves.
3. The buyer can't confirm before the seller has sent it.
4. Swapmart's key alone can't move a customer's money: delivering needs the seller's token.
5. A webhook not signed by KetaPay is refused and changes nothing.
