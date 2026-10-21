import { paidOrder } from './_flow.mjs'

export const title = 'a forged escrow.funded delivers nothing and unlocks no download'

export default async function (ctx) {
  const { assert, ketapay, get, webhook } = ctx
  const { escrow, order } = await paidOrder(ctx)
  assert.equal(await webhook('escrow.funded', escrow, 'whsec_forged'), 400)
  assert.equal((await get(`/orders/${order}/download`)).status, 403)
  assert.equal((await ketapay.escrows.retrieve(escrow.id)).milestones[0].status, 'funded')
}
