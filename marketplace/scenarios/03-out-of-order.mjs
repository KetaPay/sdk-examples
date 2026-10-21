import { paidOrder, step } from './_flow.mjs'

export const title = "the buyer can't confirm before the seller has sent it"

export default async function (ctx) {
  const { assert, ketapay } = ctx
  const { escrow, order } = await paidOrder(ctx, 'bicycle')
  const early = await step(ctx, order, 'buyer')
  assert.equal(early.status, 409)
  assert.equal(early.body.code, 'milestone_not_delivered')
  assert.equal((await ketapay.escrows.retrieve(escrow.id)).milestones[0].status, 'funded')
}
