// Shared steps for the marketplace scenarios (files starting with _ aren't scenarios)
export async function paidOrder({ assert, post, latestSession, pay, webhook, unique }, listing = 'iphone-15') {
  const bought = await post(`/listings/${listing}/buy`, { email: unique('buyer') }, true)
  assert.equal(bought.status, 303)
  const session = await latestSession()
  const escrow = await pay(session)
  assert.equal(await webhook('escrow.funded', escrow), 200)
  return { session, escrow, order: session.external_reference }
}

// A customer's step: ask for the code, then confirm with it
export async function step({ post }, order, role, code = '123456') {
  const { session_id } = (await post(`/orders/${order}/${role}/code`)).body
  return post(`/orders/${order}/${role}/confirm`, { session_id, code })
}
