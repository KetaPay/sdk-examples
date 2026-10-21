import { paidOrder } from './_flow.mjs'

export const title = "Swapmart's key alone can't move a customer's money: delivering needs the seller's token"

export default async function (ctx) {
  const { assert, ketapay } = ctx
  const { escrow } = await paidOrder(ctx)
  await assert.rejects(
    ketapay.escrows.milestones.deliver(escrow.id, escrow.milestones[0].id, {}),
    (err) => err.code === 'customer_token_required',
  )
}
