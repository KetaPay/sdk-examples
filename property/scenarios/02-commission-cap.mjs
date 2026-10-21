import { fundedSale, step } from './_flow.mjs'

export const title = "the agency's commission stops at its ₦500,000 cap for the whole sale, not 2.5% of ₦85m"

export default async function (ctx) {
  const { assert, ketapay, get } = ctx
  const { session, escrow, sale } = await fundedSale(ctx)
  assert.deepEqual(session.commission, { rate_bps: 250, min_amount: 0, max_amount: 50_000_000 })
  assert.equal(session.fees.commission, 50_000_000)

  for (const m of (await get(`/sales/${sale}`)).body.milestones) {
    await step(ctx, sale, 'owner/deliver', { milestone_id: m.id, note: 'Done' })
    await step(ctx, sale, 'buyer/accept', { milestone_id: m.id })
  }
  const taken = (await ketapay.escrows.retrieve(escrow.id)).milestones.reduce((sum, m) => sum + m.commission, 0)
  assert.equal(taken, 50_000_000, `commission taken across the three releases: ${taken}`)
}
