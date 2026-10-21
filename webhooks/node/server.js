// Receives KetaPay's webhooks: verifies each one, handles it once, and answers 200 quickly.
// Run: npm start, then expose port 4242 over https (a tunnel, or a public Codespaces port).
import express from 'express'
import { handle, ketapay, secrets } from './ketapay.js'

const app = express()

// Read the raw body: the signature covers it exactly, so parse JSON only after verifying
app.post('/webhooks', express.raw({ type: 'application/json' }), async (req, res) => {
  let event
  try {
    event = await ketapay.webhooks.verify(req.body, req.get('KetaPay-Signature'), secrets)
  } catch (err) {
    // A bad signature, or one older than 5 minutes (a replay): refuse it
    console.warn(`Refused: ${err.message}`)
    return res.sendStatus(400)
  }
  // Answer fast. Slow work belongs in a queue; KetaPay retries anything that isn't a 2xx.
  if (!handle(event)) console.log(`${event.type} ${event.id} again: already handled`)
  res.sendStatus(200)
})

app.listen(4242, () => console.log('Listening on http://localhost:4242/webhooks'))
