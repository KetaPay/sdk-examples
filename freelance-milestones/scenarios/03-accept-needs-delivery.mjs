import { fundedProject, step } from './_flow.mjs'

export const title = "the client can't accept a stage the freelancer hasn't delivered"

export default async function (ctx) {
  const { assert, get } = ctx
  const { project } = await fundedProject(ctx)
  const [design] = (await get(`/projects/${project}`)).body.milestones
  const early = await step(ctx, project, 'client', 'release', { milestone_id: design.id })
  assert.equal(early.status, 409)
  assert.equal(early.body.code, 'milestone_not_delivered')
}
