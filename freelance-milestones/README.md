# Freelance milestones

A freelance project **paid in stages**. The client pays for the whole project up front, KetaPay holds
it, and each stage (Design, Build, Launch) is paid to the freelancer only when the client accepts it.
The same shape fits agencies, construction, property deals: anything agreed and paid in parts.

```
public/   the project form and the project page (shared by both versions)
node/     the platform's server in Node (Express), using @ketapay/node from npm
php/      the same server in PHP, using ketapay/ketapay-php from Packagist
```

## What the server does

| Route | What happens |
| --- | --- |
| `POST /projects` | Creates a checkout session with three `milestones` that add up to `amount`, and sends the client to pay |
| `POST /projects/{id}/{freelancer\|client}/code` | KetaPay emails that person a one-time code (`123456` in test mode) |
| `POST /projects/{id}/freelancer/deliver` | With the freelancer's code: delivers the current stage, with a note and an optional file link |
| `POST /projects/{id}/client/release` | With the client's code: accepts the current stage and pays the freelancer for it |
| `GET /projects/{id}` | The stages as KetaPay has them, read with `escrows.retrieve` |
| `POST /webhooks` | Verifies the signature; `escrow.funded` links the project to its escrow |

Stages move in order. Delivering or accepting any stage but the current one is refused with
`milestone_not_current`. A file link is fetched once and kept by KetaPay, so what was delivered can't change
later, which matters if the client ever disputes it.

## Run it

1. Copy `.env.example` to `.env` and add your `sk_test_` key.
2. Start one version:

   ```sh
   cd node && npm install && npm start
   # or
   cd php && composer install && composer start
   ```

3. Open http://localhost:4242, enter two different emails, and pay with a test card.

For webhooks, expose port 4242 (a tunnel, or a public Codespaces port), add
`https://<your address>/webhooks` under **Developers → Webhooks** with `escrow.funded`, and put its signing
secret in `.env`.

## Try the whole flow

1. Fund the project. The project page lists the three stages as **funded**.
2. As the freelancer: write what you delivered, optionally paste a link to a PDF, **Send code**, enter
   `123456`, **Confirm**. Design is **delivered**.
3. As the client: **Send code**, `123456`, **Confirm**. Design is **released** and paid.
4. Repeat for Build and Launch. The project ends **completed**.
