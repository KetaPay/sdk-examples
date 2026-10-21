// Shared steps for the property scenarios (files starting with _ aren't scenarios)
export async function fundedSale({ assert, post, latestSession, pay, webhook, unique }) {
  const bought = await post('/listings/lekki-3-bed/buy', { email: unique('buyer') }, true)
  assert.equal(bought.status, 303)
  const session = await latestSession()
  const escrow = await pay(session)
  assert.equal(await webhook('escrow.funded', escrow), 200)
  return { session, escrow, sale: session.external_reference }
}

// A step the owner or the buyer approves with a code
export async function step({ post }, sale, action, body = {}, code = '123456') {
  const role = action.split('/')[0]
  const { session_id } = (await post(`/sales/${sale}/${role}/code`)).body
  return post(`/sales/${sale}/${action}`, { session_id, code, ...body })
}
