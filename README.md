# KetaPay SDK examples

Small, runnable projects that use the official KetaPay SDKs the way your server would. Each example
does the same thing in every language, so you can pick yours and copy what you need.

| Example | What it shows | Node | PHP |
| --- | --- | --- | --- |
| [shop-checkout](shop-checkout) | A shop selling its own goods with escrow as a way to pay: checkout, webhooks, marking an order shipped | ✓ | ✓ |

Every example runs in test mode with an `sk_test_` key: no real money moves and every one-time code is
`123456`. Get a key from the KetaPay dashboard under **Developers → API keys**.

## Run one

Locally: follow the example's README (Node 20.12+ or PHP 8.1+ with Composer).

In your browser: open this repository in GitHub Codespaces. Node and PHP are already installed. Add your
key as a [Codespaces secret](https://docs.github.com/en/codespaces/managing-your-codespaces/managing-your-account-specific-secrets-for-github-codespaces)
named `KETAPAY_SECRET_KEY`, so it never sits in a file.

## Learn more

- Docs: [docs.ketapay.com](https://docs.ketapay.com)
- SDKs: [ketapay-node](https://github.com/KetaPay/ketapay-node), [ketapay-php](https://github.com/KetaPay/ketapay-php)

Never commit a secret key. Keys belong on your server, never in a browser or an app.
