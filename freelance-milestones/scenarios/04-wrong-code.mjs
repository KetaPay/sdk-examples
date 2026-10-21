import { fundedProject, step } from './_flow.mjs'

export const title = 'a wrong one-time code is refused and the stage stays as it was'

export default async function (ctx) {
  const { assert, get } = ctx
  const { project } = await fundedProject(ctx)
  const [design] = (await get(`/projects/${project}`)).body.milestones
  const wrong = await step(ctx, project, 'freelancer', 'deliver', { milestone_id: design.id, note: 'x' }, '000000')
  assert.equal(wrong.status, 400)
  assert.equal(wrong.body.code, 'code_invalid')
  assert.equal((await get(`/projects/${project}`)).body.milestones[0].status, 'funded')
}
