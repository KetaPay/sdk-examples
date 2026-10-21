// Keyhaus: a property agency. A buyer pays for a flat through KetaPay in three stages (deposit,
// documents, keys); the owner is paid each stage only when the buyer accepts it, and Keyhaus takes a
// capped commission on the sale.
//
// 1. POST /listings/:id/buy                    checkout session: three milestones, the title documents
//                                              and photos attached, the owner as seller, a capped commission
// 2. KetaPay's checkout page                   the buyer pays the whole price (a bank transfer, for most)
// 3. POST /sales/:id/owner/code|deliver        the owner hands over the current stage, with its document
// 4. POST /sales/:id/buyer/code|accept         the buyer accepts it: the owner is paid for that stage
// 5. POST /webhooks                            keeps the sale in step with KetaPay
//
// The pages in ../public: the listing (/), the buyer's view, the owner's view and the agency admin.
import express from 'express'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import KetaPay, { KetaPayError } from '@ketapay/node'

// ../.env when there is one (shared with the PHP version); environment variables win over it
try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)))
} catch {}

const { KETAPAY_SECRET_KEY, KETAPAY_WEBHOOK_SECRET, KETAPAY_BASE_URL, BASE_URL = 'http://localhost:4242' } = process.env
const COMMISSION_BPS = Number(process.env.COMMISSION_BPS ?? 250)
const COMMISSION_MAX = Number(process.env.COMMISSION_MAX ?? 50_000_000)
if (!KETAPAY_SECRET_KEY?.startsWith('sk_test_')) {
  console.error('Set KETAPAY_SECRET_KEY to your sk_test_ key in property/.env (see .env.example).')
  process.exit(1)
}

const ketapay = new KetaPay({ apiKey: KETAPAY_SECRET_KEY, ...(KETAPAY_BASE_URL ? { baseUrl: KETAPAY_BASE_URL } : {}) })

// Your database. In memory here: sales are lost when the server restarts.
const LISTINGS = {
  'lekki-3-bed': {
    title: '3-bedroom flat, Lekki Phase 1',
    description:
      'Third-floor 3-bedroom flat with Governor\'s Consent, 24-hour power, two parking spaces and a pool. Sold with the ' +
      'deed of assignment and survey plan; no outstanding service charge.',
    price: 8_500_000_000, // kobo: ₦85,000,000
    owner: { email: 'owner.adeyemi@example.com', name: 'Funke Adeyemi' },
    // What the buyer agrees to, kept on the escrow: KetaPay records each file's fingerprint
    documents: [{ name: 'Survey plan.pdf', url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf' }],
    stages: [
      { title: 'Deposit', description: 'Offer accepted and the sale agreement signed', share: 0.1 },
      { title: 'Documents', description: 'Deed of assignment and survey plan handed to the buyer\'s lawyer', share: 0.6 },
      { title: 'Keys', description: 'Keys handed over and the buyer takes possession', share: 0.3 },
    ],
  },
}
const sales = new Map()

const app = express()
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))))

app.get('/api/listings/:id', (req, res) => {
  const l = LISTINGS[req.params.id]
  if (!l) return res.sendStatus(404)
  res.json({ id: req.params.id, title: l.title, description: l.description, price: l.price, owner: l.owner.name, stages: plan(l) })
})

// The stages in kobo; the last one takes any rounding, so they always add up to the price
function plan(listing) {
  const amounts = listing.stages.map((s) => Math.round(listing.price * s.share))
  amounts[amounts.length - 1] = listing.price - amounts.slice(0, -1).reduce((a, b) => a + b, 0)
  return listing.stages.map((s, i) => ({ title: s.title, description: s.description, amount: amounts[i] }))
}

// Step 1: the buyer clicked "Buy with escrow"
app.post('/listings/:id/buy', express.urlencoded({ extended: false }), express.json(), async (req, res) => {
  const listing = LISTINGS[req.params.id]
  if (!listing) return res.sendStatus(404)
  const sale = { id: randomUUID(), title: listing.title, status: 'awaiting_payment', escrow_id: null, webhooks: [] }
  const session = await ketapay.checkoutSessions.create({
    amount: listing.price,
    category: 'property',
    title: listing.title,
    description: listing.description,
    attachments: listing.documents,
    milestones: plan(listing),
    buyer: { email: req.body.email },
    seller: listing.owner,
    // Keyhaus's fee: a share of the price, never more than the cap, taken from the owner's side
    commission: { rate_bps: COMMISSION_BPS, max_amount: COMMISSION_MAX },
    external_reference: sale.id,
    return_url: `${BASE_URL}/buyer.html?sale=${sale.id}`,
  })
  sales.set(sale.id, { ...sale, buyer: req.body.email, owner: listing.owner.email, commission: session.fees.commission })
  // A JSON post ("Pay on this page", @ketapay/checkout) gets the url back to open over the page
  if (req.is('json')) return res.json({ url: session.url, return_url: session.return_url })
  res.redirect(303, session.url)
})

// KetaPay emails the owner or the buyer a one-time code; the token from it lasts 15 minutes
app.post('/sales/:id/:role/code', express.json(), async (req, res) => {
  const sale = sales.get(req.params.id)
  if (!sale) return res.sendStatus(404)
  const session = await ketapay.customerSessions.create({ email: req.params.role === 'owner' ? sale.owner : sale.buyer })
  res.json({ session_id: session.id })
})

// Step 3: the owner hands over the current stage, with the document that proves it
app.post('/sales/:id/owner/deliver', express.json(), async (req, res) => {
  const sale = sales.get(req.params.id)
  if (!sale?.escrow_id) return res.sendStatus(404)
  const { token } = await ketapay.customerSessions.verify(req.body.session_id, req.body.code)
  const { milestone_id, note, link } = req.body
  const escrow = await ketapay.escrows.milestones.deliver(
    sale.escrow_id,
    milestone_id,
    { note, attachments: link ? [{ url: link }] : [] },
    { customerToken: token },
  )
  res.json(view(sale, escrow))
})

// Step 4: the buyer accepts the current stage, which pays the owner for it
app.post('/sales/:id/buyer/accept', express.json(), async (req, res) => {
  const sale = sales.get(req.params.id)
  if (!sale?.escrow_id) return res.sendStatus(404)
  const { token } = await ketapay.customerSessions.verify(req.body.session_id, req.body.code)
  const escrow = await ketapay.escrows.milestones.release(sale.escrow_id, req.body.milestone_id, {}, { customerToken: token })
  res.json(view(sale, escrow))
})

// The agency admin's list, newest first, with the commission each sale earns
app.get('/sales', (_req, res) =>
  res.json([...sales.values()].reverse().map(({ id, title, status, commission }) => ({ id, title, status, commission }))),
)

app.get('/sales/:id', async (req, res) => {
  const sale = sales.get(req.params.id)
  if (!sale) return res.sendStatus(404)
  res.json(view(sale, sale.escrow_id ? await ketapay.escrows.retrieve(sale.escrow_id) : null))
})

// The "what's happening" panel: the escrow as KetaPay has it, and the webhooks Keyhaus received
app.get('/sales/:id/activity', async (req, res) => {
  const sale = sales.get(req.params.id)
  if (!sale) return res.sendStatus(404)
  res.json({ escrow: sale.escrow_id ? await ketapay.escrows.retrieve(sale.escrow_id) : null, webhooks: sale.webhooks })
})

function view(sale, escrow) {
  return {
    id: sale.id,
    title: sale.title,
    status: escrow?.status ?? sale.status,
    commission: sale.commission,
    milestones: (escrow?.milestones ?? []).map((m) => ({ id: m.id, title: m.title, amount: m.amount, status: m.status, delivery: m.delivery })),
  }
}

// Step 5: KetaPay tells Keyhaus what happened. Read the raw body: the signature covers it exactly.
app.post('/webhooks', express.raw({ type: 'application/json' }), async (req, res) => {
  let event
  try {
    event = await ketapay.webhooks.verify(req.body, req.get('KetaPay-Signature'), KETAPAY_WEBHOOK_SECRET)
  } catch (err) {
    console.warn(`Refused a webhook: ${err.message}`)
    return res.sendStatus(400)
  }
  const escrow = event.data.object
  const sale = sales.get(escrow.external_reference)
  if (sale) {
    sale.webhooks.push({ type: event.type, received_at: new Date().toISOString() })
    if (event.type === 'escrow.funded') Object.assign(sale, { status: 'funded', escrow_id: escrow.id })
    console.log(`${event.type}: sale ${sale.id}`)
  }
  res.sendStatus(200)
})

// A wrong code or a stage out of order comes back as a KetaPay error with a message to show
app.use((err, _req, res, _next) => {
  if (err instanceof KetaPayError) return res.status(err.statusCode ?? 400).json({ error: err.message, code: err.code })
  console.error(err)
  res.status(500).json({ error: 'Something went wrong' })
})

app.listen(4242, () => console.log(`Keyhaus running on ${BASE_URL}`))
