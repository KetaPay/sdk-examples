// Shared steps for the digital goods scenarios (files starting with _ aren't scenarios)
export async function paidOrder({ assert, post, latestSession, pay, webhook, unique }, product = 'ebook-cooking') {
  const email = unique('buyer')
  const checkout = await post('/checkout', { product, email }, true)
  assert.equal(checkout.status, 303)
  const session = await latestSession()
  const escrow = await pay(session)
  return { session, escrow, email, order: session.external_reference, funded: () => webhook('escrow.funded', escrow) }
}
