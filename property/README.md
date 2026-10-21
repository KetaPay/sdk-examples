# Property: a large sale paid in stages, with documents

**Keyhaus** is a property agency. A buyer wants a ₦85,000,000 flat in Lekki. Property fraud is common:
fake title documents, the same flat sold twice, keys never handed over. Buyers won't wire ₦85m to a
stranger, and owners won't hand over documents before they see the money.

Escrow in stages fits how a property sale really happens. The buyer pays the full price into KetaPay,
usually by bank transfer, so the owner knows the money is there. The owner is then paid one stage at a
time, as each one happens and the buyer accepts it:

| Stage | Share | What happens |
| --- | --- | --- |
| Deposit | 10% (₦8.5m) | Offer accepted and the sale agreement signed |
| Documents | 60% (₦51m) | Deed of assignment and survey plan handed to the buyer's lawyer |
| Keys | 30% (₦25.5m) | Keys handed over and the buyer takes possession |

Keyhaus earns **2.5% commission, capped at ₦500,000** for the whole sale (`commission.max_amount`).

## How the money moves

```
Buyer pays ₦85,000,000 + KetaPay's buyer fee ──▶ KetaPay holds it, in three milestones
Owner hands over a stage (note + document) ──▶ buyer checks it, accepts ──▶ owner paid for that stage
                                                                        ──▶ Keyhaus's share of its commission
A stage doesn't happen ──▶ the buyer doesn't accept it; KetaPay looks into it; unpaid stages can go back
```

What the buyer agreed to (the description and the survey plan) is attached to the escrow when they pay.
KetaPay fetches each document once and records its fingerprint, so a document changed later is caught.
The owner and the buyer approve their own steps with a one-time code. Keyhaus's key alone can't move
the money. An owner new to KetaPay has large payouts held until they verify their identity with KetaPay.

> **Known issue (KetaPay API, being fixed in KetaPay/api#254):** the commission cap is applied to each stage
> instead of to the whole sale, so this sale takes ₦1,212,500 instead of the ₦500,000 the checkout quotes.
> Scenario 2 fails until the fix is live, and passes against it.

## What's in it

```
public/index.html    the listing: price, stages, "Buy with escrow"
public/buyer.html    the buyer's view: accept the handed-over stage, the "what's happening" panel
public/owner.html    the owner's view: hand over the current stage with a document, the panel
public/admin.html    the agency admin: every sale, its commission, links to each side's view
public/stages.js     the stage list both views share
node/server.js       the server in Node (Express), using @ketapay/node from npm
php/index.php        the same server in PHP, using ketapay/ketapay-php from Packagist
scenarios/           what must hold, run against either server
```

| Route | What happens |
| --- | --- |
| `GET /api/listings/{id}` | The listing and its stages, worked out on the server so they always add up to the price |
| `POST /listings/{id}/buy` | A checkout session: `category: property`, three `milestones`, the survey plan in `attachments`, the owner as `seller`, `commission` with `max_amount` |
| `POST /sales/{id}/{owner\|buyer}/code` | KetaPay emails that person a one-time code |
| `POST /sales/{id}/owner/deliver` | With the owner's code: hands over the current stage, with a note and a document link |
| `POST /sales/{id}/buyer/accept` | With the buyer's code: accepts the stage and pays the owner for it |
| `GET /sales`, `/sales/{id}`, `/sales/{id}/activity` | The admin list (with commission), one sale, and the panel |
| `POST /webhooks` | Verifies the signature; `escrow.funded` links the sale to its escrow |

## Run it

1. Copy `.env.example` to `.env`, add your `sk_test_` key, and keep `COMMISSION_BPS` within your KetaPay
   agreement.
2. `cd node && npm install && npm start`, or `cd php && composer install && composer start`.
3. Open http://localhost:4242 and buy the flat (in test mode, pay by card or bank transfer). You land on the
   buyer's view; the header links to the owner's view.

For webhooks locally, expose port 4242 over https, add `https://<your address>/webhooks` under
**Developers → Webhooks** with `escrow.funded`, and put its signing secret in `.env`.

## Scenarios

```sh
cd ../tools && npm install && npm run scenarios -- property node   # or php
```

1. Deposit, documents and keys are each handed over then accepted, and the sale completes.
2. The agency's commission stops at its ₦500,000 cap for the whole sale. (Fails until api#254 is live.)
3. The buyer can't pay the owner for a stage that hasn't been handed over.
4. The documents stage can't be handed over before the deposit stage is paid.
5. A webhook not signed by KetaPay is refused and changes nothing.
