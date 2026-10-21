import { fundedSale, step } from './_flow.mjs'

export const title = "the buyer can't pay the owner for a stage that hasn't been handed over"

export default async function (ctx) {
  const { assert, get } = ctx
  const { sale } = await fundedSale(ctx)
  const [deposit] = (await get(`/sales/${sale}`)).body.milestones
  const early = await step(ctx, sale, 'buyer/accept', { milestone_id: deposit.id })
  assert.equal(early.status, 409)
  assert.equal(early.body.code, 'milestone_not_delivered')
}
