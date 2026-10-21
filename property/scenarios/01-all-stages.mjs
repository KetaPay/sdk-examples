import { fundedSale, step } from './_flow.mjs'

export const title = 'deposit, documents and keys are each handed over then accepted, and the sale completes'

export default async function (ctx) {
  const { assert, ketapay, get } = ctx
  const { session, escrow, sale } = await fundedSale(ctx)
  assert.equal(session.category, 'property')
  assert.deepEqual(session.milestones.map((m) => m.amount), [850_000_000, 5_100_000_000, 2_550_000_000])
  assert.equal(session.attachments.length, 1)

  const stages = (await get(`/sales/${sale}`)).body.milestones
  for (const [i, m] of stages.entries()) {
    const handed = await step(ctx, sale, 'owner/deliver', { milestone_id: m.id, note: `${m.title} handed over` })
    assert.equal(handed.status, 200, JSON.stringify(handed.body))
    const accepted = await step(ctx, sale, 'buyer/accept', { milestone_id: m.id })
    assert.equal(accepted.body.milestones[i].status, 'released')
  }
  assert.equal((await get(`/sales/${sale}`)).body.status, 'completed')
  assert.equal((await ketapay.escrows.retrieve(escrow.id)).status, 'completed')
}
