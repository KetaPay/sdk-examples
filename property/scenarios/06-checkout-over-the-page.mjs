export const title = 'a JSON purchase gets the url back, for "Pay on this page" to open over the page'

export default async function ({ assert, post, latestSession, unique }) {
  const res = await post('/listings/lekki-3-bed/buy', { email: unique('buyer') })
  const session = await latestSession()
  assert.equal(res.status, 200)
  assert.equal(res.body.url, session.url)
  assert.equal(res.body.return_url, session.return_url)
  assert.ok(session.return_url.includes(session.external_reference))
}
