# KetaPay SDK examples

Small, runnable businesses that take payments through KetaPay escrow, each written with the official
SDKs in Node and PHP. Every example tells its business's story first (who pays whom, what KetaPay holds
and when it releases, what each side sees), then shows the code for each step.

| Example | Kind of sale | What it shows |
| --- | --- | --- |
| [shop-checkout](shop-checkout) | Goods the business sells itself | No `seller` (the shop is paid), a shop admin that ships orders with its key alone |
| [marketplace](marketplace) | Goods between customers | Buyer and seller each approve their step with a one-time code; the platform's commission |
| [freelance-milestones](freelance-milestones) | Services in stages | Three milestones, delivery with a file, the client accepting stage by stage |
| [property](property) | Property | A large sale: deposit, documents and keys as milestones, title documents attached, a capped commission |
| [digital-goods](digital-goods) | Digital | Delivery straight from the `escrow.funded` webhook, safe to receive twice; a refund turns the download off |
| [webhooks](webhooks) | Any | Receiving webhooks properly: verify, handle once, catch up after downtime, rotate the secret |

Every page has a **"what's happening" panel**: the escrow as KetaPay has it (fees, commission,
milestones, timeline) and the webhooks your server received, updating as you click through.

## How each example is laid out

```
<example>/
  README.md        the business, how the money moves, the routes, how to run it
  .env.example     copy to .env and add your sk_test_ key
  public/          the pages (buyer, seller, admin) and the panel, shared by both versions
  node/server.js   the whole server in one file, step by step, using @ketapay/node from npm
  php/index.php    the same server in PHP, using ketapay/ketapay-php from Packagist
  scenarios/       what must hold, run over HTTP against either version
tools/             the scenario runner, and shared/ (the panel and styles copied into each public/)
```

Each server is deliberately one file you can read top to bottom. Your own app will split it into
routes, services and a database; here, every KetaPay call is in plain sight in the order it happens.

## Run one

Every example runs in test mode with an `sk_test_` key: no real money moves and every one-time code is
`123456`. Get a key from the KetaPay dashboard under **Developers → API keys**.

- **Locally:** follow the example's README (Node 20.12+, or PHP 8.1+ with Composer).
- **In your browser:** open this repository in GitHub Codespaces. Node and PHP are already installed. Add
  your key as a [Codespaces secret](https://docs.github.com/en/codespaces/managing-your-codespaces/managing-your-account-specific-secrets-for-github-codespaces)
  named `KETAPAY_SECRET_KEY`, so it never sits in a file.

## Run the scenarios

```sh
cd tools && npm install
npm run scenarios -- marketplace node   # starts the Node server, runs marketplace/scenarios, stops it
npm run scenarios -- marketplace php    # the same scenarios against the PHP server
```

The runner pays with KetaPay's sandbox helper and signs webhooks with your `KETAPAY_WEBHOOK_SECRET`, so
no tunnel is needed. Changed something in `tools/shared/`? Run `npm run sync` to copy it into every example.

## Learn more

- Docs: [docs.ketapay.com](https://docs.ketapay.com)
- SDKs: [ketapay-node](https://github.com/KetaPay/ketapay-node), [ketapay-php](https://github.com/KetaPay/ketapay-php)

Never commit a secret key. Keys belong on your server, never in a browser or an app.
