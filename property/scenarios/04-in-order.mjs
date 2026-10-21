import { fundedSale, step } from './_flow.mjs'

export const title = "the documents stage can't be handed over before the deposit stage is paid"

export default async function (ctx) {
  const { assert, get } = ctx
  const { sale } = await fundedSale(ctx)
  const [, documents] = (await get(`/sales/${sale}`)).body.milestones
  const early = await step(ctx, sale, 'owner/deliver', { milestone_id: documents.id, note: 'Documents first' })
  assert.equal(early.status, 409)
  assert.equal(early.body.code, 'milestone_not_current')
}
