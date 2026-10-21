# Freelance milestones: services paid in stages

**Gigline** connects businesses with freelancers. A client wants a company website. The freelancer
won't start without knowing the money is there, and the client won't pay ₦2,000,000 up front to someone
they've never worked with.

Escrow in stages solves both. The client funds the whole project at once, so the freelancer knows the
money exists, but KetaPay holds it. Each stage (Design, Build, Launch) is paid to the freelancer only
when the client accepts it. The same shape fits agencies, construction, events: anything agreed up
front and delivered in parts.

## How the money moves

```
Client funds ₦2,000,000 + KetaPay's buyer fee ──▶ KetaPay holds it, split into three milestones
Design   ₦400,000    freelancer delivers (note + file) ──▶ client accepts ──▶ freelancer paid for Design
Build    ₦1,100,000  only once Design is paid
Launch   ₦500,000    only once Build is paid ──▶ project completed
Client unhappy with a stage ──▶ doesn't accept it; KetaPay looks into it; unpaid stages can go back
```

Both sides approve their own steps with a one-time code that KetaPay emails them: the freelancer to
deliver, the client to accept. Gigline's key alone can't move the money. In test mode the code is
always `123456`.

When the freelancer attaches a file link, KetaPay fetches it once and records its fingerprint (type,
size, SHA-256). If the file is swapped later, the change is caught, which matters if the client ever
disputes what was delivered.

## What's in it

```
public/index.html        the project: three stages, client and freelancer emails, "Fund the project"
public/client.html       the client's view: stages, accept the delivered one, the "what's happening" panel
public/freelancer.html   the freelancer's view: deliver the current stage with a note and a file, the panel
node/server.js           the server in Node (Express), using @ketapay/node from npm
php/index.php            the same server in PHP, using ketapay/ketapay-php from Packagist
scenarios/               what must hold, run against either server
```

| Route | What happens |
| --- | --- |
| `POST /projects` | A checkout session with three `milestones` adding up to `amount`, then a redirect to pay |
| `POST /projects/{id}/{freelancer\|client}/code` | KetaPay emails that person a one-time code |
| `POST /projects/{id}/freelancer/deliver` | With the freelancer's code: delivers the current stage, with a note and an optional file link |
| `POST /projects/{id}/client/release` | With the client's code: accepts the current stage and pays the freelancer for it |
| `GET /projects/{id}`, `/projects/{id}/activity` | The stages as KetaPay has them (`escrows.retrieve`), and the panel |
| `POST /webhooks` | Verifies the signature; `escrow.funded` links the project to its escrow |

Stages move in order: delivering or accepting any stage but the current one is refused
(`milestone_not_current`, `milestone_not_delivered`).

## Run it

1. Copy `.env.example` to `.env` and add your `sk_test_` key.
2. `cd node && npm install && npm start`, or `cd php && composer install && composer start`.
3. Open http://localhost:4242, enter two different emails, and pay with a test card. You land on the
   client's view; the header links to the freelancer's view.

For webhooks locally, expose port 4242 over https, add `https://<your address>/webhooks` under
**Developers → Webhooks** with `escrow.funded`, and put its signing secret in `.env`.

## Scenarios

```sh
cd ../tools && npm install && npm run scenarios -- freelance-milestones node   # or php
```

1. Each stage is delivered, then accepted in turn, and the project completes.
2. Stage 2 can't be delivered before stage 1 is paid.
3. The client can't accept a stage the freelancer hasn't delivered.
4. A wrong one-time code is refused and the stage stays as it was.
5. A delivered PDF is recorded on the milestone; a web page instead of a file is refused.
