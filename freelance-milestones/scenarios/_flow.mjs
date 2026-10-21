// Shared steps for the freelance scenarios (files starting with _ aren't scenarios)
export async function fundedProject({ assert, post, latestSession, pay, webhook, unique }) {
  const funded = await post('/projects', { client: unique('client'), freelancer: unique('freelancer') }, true)
  assert.equal(funded.status, 303)
  const session = await latestSession()
  const escrow = await pay(session)
  assert.equal(await webhook('escrow.funded', escrow), 200)
  return { session, escrow, project: session.external_reference }
}

// A step the client or the freelancer approves with a code
export async function step({ post }, project, role, action, body = {}, code = '123456') {
  const { session_id } = (await post(`/projects/${project}/${role}/code`)).body
  return post(`/projects/${project}/${role}/${action}`, { session_id, code, ...body })
}
