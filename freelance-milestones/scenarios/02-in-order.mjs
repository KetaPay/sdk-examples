import { fundedProject, step } from './_flow.mjs'

export const title = 'stage 2 can\'t be delivered before stage 1 is paid (milestone_not_current)'

export default async function (ctx) {
  const { assert, get } = ctx
  const { project } = await fundedProject(ctx)
  const [, build] = (await get(`/projects/${project}`)).body.milestones
  const early = await step(ctx, project, 'freelancer', 'deliver', { milestone_id: build.id, note: 'Build first' })
  assert.equal(early.status, 409)
  assert.equal(early.body.code, 'milestone_not_current')
}
