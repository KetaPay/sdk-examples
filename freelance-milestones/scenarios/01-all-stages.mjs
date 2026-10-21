import { fundedProject, step } from './_flow.mjs'

export const title = 'each stage is delivered then accepted in turn, and the project completes'

export default async function (ctx) {
  const { assert, ketapay, get } = ctx
  const { session, escrow, project } = await fundedProject(ctx)
  assert.deepEqual(session.milestones.map((m) => m.amount), [40_000_000, 110_000_000, 50_000_000])
  let view = (await get(`/projects/${project}`)).body
  assert.deepEqual(view.milestones.map((m) => m.status), ['funded', 'funded', 'funded'])

  for (const [i, m] of view.milestones.entries()) {
    const delivered = await step(ctx, project, 'freelancer', 'deliver', { milestone_id: m.id, note: `${m.title} done` })
    assert.equal(delivered.status, 200, JSON.stringify(delivered.body))
    assert.equal(delivered.body.milestones[i].status, 'delivered')
    const accepted = await step(ctx, project, 'client', 'release', { milestone_id: m.id })
    assert.equal(accepted.body.milestones[i].status, 'released')
  }
  view = (await get(`/projects/${project}`)).body
  assert.equal(view.status, 'completed')
  assert.equal((await ketapay.escrows.retrieve(escrow.id)).milestones.filter((m) => m.status === 'released').length, 3)
}
