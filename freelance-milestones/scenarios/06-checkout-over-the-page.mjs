export const title = 'a JSON project gets the url back, for "Pay on this page" to open over the page'

export default async function ({ assert, post, latestSession, unique }) {
  const res = await post('/projects', { client: unique('client'), freelancer: unique('freelancer') })
  const session = await latestSession()
  assert.equal(res.status, 200)
  assert.equal(res.body.url, session.url)
  assert.equal(res.body.return_url, session.return_url)
  assert.ok(session.return_url.includes(session.external_reference))
}
