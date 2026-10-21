// Gigline: a freelance platform. A client pays for a project up front in stages (milestones), KetaPay
// holds the money, and each stage is paid to the freelancer only when the client accepts it.
//
// 1. POST /projects                              checkout session with the plan: Design, Build, Launch
// 2. KetaPay's page                              the client pays for the whole project
// 3. POST /projects/:id/freelancer/code|deliver  the freelancer delivers the current stage, with a note and a file
// 4. POST /projects/:id/client/code|release      the client accepts it: that stage is paid
// 5. GET /projects/:id                           the stages as KetaPay has them
//
// Stages move in order: only the first one not yet paid can be delivered or accepted.
// The pages in ../public: post a project (/), the client's view and the freelancer's view.
import express from 'express'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import KetaPay, { KetaPayError } from '@ketapay/node'

// ../.env when there is one (shared with the PHP version); environment variables win over it
try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)))
} catch {}

const { KETAPAY_SECRET_KEY, KETAPAY_WEBHOOK_SECRET, KETAPAY_BASE_URL, BASE_URL = 'http://localhost:4242' } = process.env
if (!KETAPAY_SECRET_KEY?.startsWith('sk_test_')) {
  console.error('Set KETAPAY_SECRET_KEY to your sk_test_ key in freelance-milestones/.env (see .env.example).')
  process.exit(1)
}

const ketapay = new KetaPay({ apiKey: KETAPAY_SECRET_KEY, ...(KETAPAY_BASE_URL ? { baseUrl: KETAPAY_BASE_URL } : {}) })

// Your database. In memory here: projects are lost when the server restarts.
const projects = new Map()

const app = express()
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))))

// Step 1: the client funds the project
app.post('/projects', express.urlencoded({ extended: false }), express.json(), async (req, res) => {
  const project = { id: randomUUID(), status: 'awaiting_payment', escrow_id: null, webhooks: [] }
  const session = await ketapay.checkoutSessions.create({
    amount: 200_000_000, // kobo: ₦2,000,000, the sum of the stages
    category: 'services',
    title: 'Company website',
    description: 'Five-page marketing site: design, build on Next.js, and launch on the client domain.',
    milestones: [
      { title: 'Design', description: 'Homepage and four inner pages in Figma', amount: 40_000_000 },
      { title: 'Build', description: 'All five pages built and responsive', amount: 110_000_000 },
      { title: 'Launch', description: 'Live on the client domain with analytics', amount: 50_000_000 },
    ],
    buyer: { email: req.body.client },
    seller: { email: req.body.freelancer },
    external_reference: project.id,
    return_url: `${BASE_URL}/client.html?project=${project.id}`,
  })
  projects.set(project.id, { ...project, client: req.body.client, freelancer: req.body.freelancer })
  // A JSON post ("Pay on this page", @ketapay/checkout) gets the url back to open over the page
  if (req.is('json')) return res.json({ url: session.url, return_url: session.return_url })
  res.redirect(303, session.url)
})

// KetaPay emails the freelancer or the client a one-time code. Their token from it lasts 15 minutes.
app.post('/projects/:id/:role/code', express.json(), async (req, res) => {
  const project = projects.get(req.params.id)
  if (!project) return res.sendStatus(404)
  const session = await ketapay.customerSessions.create({ email: req.params.role === 'client' ? project.client : project.freelancer })
  res.json({ session_id: session.id })
})

// Step 3: the freelancer delivers the current stage. KetaPay fetches a file link once and records its
// fingerprint (type, size, SHA-256), so a file swapped later is caught (PDF, image, Word or Excel, up to 25 MB).
app.post('/projects/:id/freelancer/deliver', express.json(), async (req, res) => {
  const project = projects.get(req.params.id)
  if (!project?.escrow_id) return res.sendStatus(404)
  const { token } = await ketapay.customerSessions.verify(req.body.session_id, req.body.code)
  const { note, link, milestone_id } = req.body
  const escrow = await ketapay.escrows.milestones.deliver(
    project.escrow_id,
    milestone_id,
    { note, attachments: link ? [{ url: link }] : [] },
    { customerToken: token },
  )
  res.json(view(project, escrow))
})

// Step 4: the client accepts the current stage, which pays the freelancer for it
app.post('/projects/:id/client/release', express.json(), async (req, res) => {
  const project = projects.get(req.params.id)
  if (!project?.escrow_id) return res.sendStatus(404)
  const { token } = await ketapay.customerSessions.verify(req.body.session_id, req.body.code)
  const escrow = await ketapay.escrows.milestones.release(project.escrow_id, req.body.milestone_id, {}, { customerToken: token })
  res.json(view(project, escrow))
})

// Step 5: the stages come from KetaPay, so the page always shows what really happened
app.get('/projects/:id', async (req, res) => {
  const project = projects.get(req.params.id)
  if (!project) return res.sendStatus(404)
  res.json(view(project, project.escrow_id ? await ketapay.escrows.retrieve(project.escrow_id) : null))
})

// The "what's happening" panel: the escrow as KetaPay has it, and the webhooks Gigline received
app.get('/projects/:id/activity', async (req, res) => {
  const project = projects.get(req.params.id)
  if (!project) return res.sendStatus(404)
  res.json({ escrow: project.escrow_id ? await ketapay.escrows.retrieve(project.escrow_id) : null, webhooks: project.webhooks })
})

function view(project, escrow) {
  return {
    id: project.id,
    status: escrow?.status ?? project.status,
    milestones: (escrow?.milestones ?? []).map((m) => ({ id: m.id, title: m.title, status: m.status, delivery: m.delivery })),
  }
}

// KetaPay tells you when the project is paid for, and when each stage moves
app.post('/webhooks', express.raw({ type: 'application/json' }), async (req, res) => {
  let event
  try {
    event = await ketapay.webhooks.verify(req.body, req.get('KetaPay-Signature'), KETAPAY_WEBHOOK_SECRET)
  } catch (err) {
    console.warn(`Refused a webhook: ${err.message}`)
    return res.sendStatus(400)
  }
  const escrow = event.data.object
  const project = projects.get(escrow.external_reference)
  if (project) {
    project.webhooks.push({ type: event.type, received_at: new Date().toISOString() })
    if (event.type === 'escrow.funded') Object.assign(project, { status: 'funded', escrow_id: escrow.id })
    console.log(`${event.type}: project ${project.id}`)
  }
  res.sendStatus(200)
})

// A wrong code or a stage out of order comes back as a KetaPay error with a message to show
app.use((err, _req, res, _next) => {
  if (err instanceof KetaPayError) return res.status(err.statusCode ?? 400).json({ error: err.message, code: err.code })
  console.error(err)
  res.status(500).json({ error: 'Something went wrong' })
})

app.listen(4242, () => console.log(`Gigline running on ${BASE_URL}`))
