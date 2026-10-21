# Webhooks

How to receive KetaPay's webhooks properly, with no UI: a receiver and four small scripts. Every other
example has a webhook route; this one covers what they leave out.

```
node/   server.js plus setup, send-test, catch-up and rotate, using @ketapay/node from npm
php/    the same in PHP, using ketapay/ketapay-php from Packagist
```

| Command (Node: `npm run …`, PHP: `composer …`) | What it shows |
| --- | --- |
| `setup -- https://your-address/webhooks` | Adds an endpoint from code and prints its signing secret, shown only once |
| `start` | The receiver: verifies the signature on the raw body, refuses forgeries and replays older than 5 minutes, handles each event once, answers 200 fast |
| `send-test -- <endpoint id> [type]` | Has KetaPay send a sample event now, and shows how your server answered |
| `catch-up` | Handles every event missed while your server was down: lists events since the newest one handled, oldest first, skipping ones already done |
| `rotate -- <endpoint id>` | Replaces the signing secret. The old one keeps signing until the time it prints, so the receiver accepts both meanwhile |

## Run it

1. Copy `.env.example` to `.env` and add your `sk_test_` key.
2. Install: `cd node && npm install`, or `cd php && composer install`.
3. Start the receiver (`start`) and expose port 4242 over https: a tunnel such as
   `cloudflared tunnel --url http://localhost:4242`, or a public Codespaces port. KetaPay only sends to https.
4. `setup -- https://<your address>/webhooks`, and put the printed secret in `.env` as
   `KETAPAY_WEBHOOK_SECRET`. Restart the receiver.
5. `send-test -- <endpoint id>` and watch the receiver log it. Run it again: same answer, handled once.

## Things to get right

- **Verify the raw body.** Parse the JSON only after `webhooks.verify`; a body re-serialised by a JSON
  parser no longer matches the signature.
- **Handle each event once.** KetaPay retries until you answer 2xx, so the same event can arrive more
  than once. Keep the ids you've handled (a JSON file here, your database in real life).
- **Answer fast.** Do slow work after answering, or in a queue.
- **Catch up after downtime.** Events are kept, so run `catch-up` (or the same code on a schedule) after a
  deploy or an outage instead of trusting that nothing was missed.
- **Rotate without downtime.** Accept the new and the previous secret until the previous one expires.

## Scenarios

```sh
cd ../tools && npm install && npm run scenarios -- webhooks node   # or php
```

1. A delivery signed by KetaPay is verified and answered 200.
2. The same event delivered twice is answered 200 both times, and handled once.
3. A delivery signed with any other secret is refused.
4. A genuine delivery replayed 10 minutes later is refused.
