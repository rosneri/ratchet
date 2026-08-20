import type { Model } from '../model/types.ts'
import type { Check, CheckResult, StageName } from '../types.ts'
import { BUILDER_SYSTEM } from './prompts.ts'

export interface BuilderContext {
  task: string
  cwd: string
  /** Checks the repo has already earned — the Builder sees them before writing anything. */
  inherited: Check[]
  plan?: string
  notes?: string
}

function ratchetBriefing(checks: Check[]): string {
  if (checks.length === 0) return 'This repository has no checks yet. You are writing the first precedent.'
  const lines = checks.map((c) => `- ${c.name}: ${c.title}\n    ${c.message}`)
  return `This repository has earned ${checks.length} deterministic check(s). They will run against your work and they do not negotiate:\n${lines.join('\n')}`
}

export async function gatherContext(model: Model, ctx: BuilderContext): Promise<string> {
  const reply = await model.run({
    role: 'builder',
    system: BUILDER_SYSTEM,
    cwd: ctx.cwd,
    tools: 'read-only',
    prompt: `Task: ${ctx.task}

${ratchetBriefing(ctx.inherited)}

Explore the repository and report what a competent implementer needs to know before
touching anything: the files involved, the existing helpers you must reuse rather
than reimplement, and the conventions in play. Be specific and cite paths. Do not
write any code yet.`,
  })
  return reply.text
}

export async function plan(model: Model, ctx: BuilderContext & { context: string }): Promise<string> {
  const reply = await model.run({
    role: 'builder',
    system: BUILDER_SYSTEM,
    cwd: ctx.cwd,
    tools: 'read-only',
    prompt: `Task: ${ctx.task}

What you found:
${ctx.context}

${ratchetBriefing(ctx.inherited)}

Write the smallest plan that completes the task: the files you will touch, what
changes in each, and which existing symbols you will reuse. Keep it under 15 lines.`,
  })
  return reply.text
}

export async function implement(model: Model, ctx: BuilderContext & { plan: string }): Promise<string> {
  const reply = await model.run({
    role: 'builder',
    system: BUILDER_SYSTEM,
    cwd: ctx.cwd,
    tools: 'edit',
    prompt: `Task: ${ctx.task}

Your plan:
${ctx.plan}

${ratchetBriefing(ctx.inherited)}

Implement it now. When you are done, summarise what you changed in a few lines.`,
  })
  return reply.text
}

/** Feed a gauntlet failure back to the Builder. The check's own message is the brief. */
export async function repairFromGauntlet(
  model: Model,
  ctx: BuilderContext,
  failures: Array<{ check: Check; result: CheckResult }>,
): Promise<string> {
  const report = failures
    .map(({ check, result }) => {
      const vs = result.violations
        .slice(0, 20)
        .map((v) => `    ${v.file}${v.line ? `:${v.line}` : ''} — ${v.detail}${v.excerpt ? `\n      > ${v.excerpt}` : ''}`)
        .join('\n')
      return `- CHECK FAILED: ${check.name} — ${check.title}\n  ${check.message}\n${vs}`
    })
    .join('\n\n')

  const reply = await model.run({
    role: 'builder',
    system: BUILDER_SYSTEM,
    cwd: ctx.cwd,
    tools: 'edit',
    prompt: `Task: ${ctx.task}

The deterministic gauntlet rejected your change:

${report}

These checks were earned by earlier real defects in this repository. Fix the cause.
Do not modify, disable or delete any file under .ratchet/. Report what you changed.`,
  })
  return reply.text
}

/** Feed a Critic finding back to the Builder. */
export async function repairFromFinding(
  model: Model,
  ctx: BuilderContext,
  finding: { title: string; detail: string; files: string[] },
): Promise<string> {
  const reply = await model.run({
    role: 'builder',
    system: BUILDER_SYSTEM,
    cwd: ctx.cwd,
    tools: 'edit',
    prompt: `Task: ${ctx.task}

The Critic rejected your change:

  ${finding.title}
  ${finding.detail}
  Files: ${finding.files.join(', ') || '(unspecified)'}

Fix it properly — the repair is about to be frozen and used as the reference tree for
a permanent check, so a workaround will be caught. Report what you changed.`,
  })
  return reply.text
}

export const STAGE_LABEL: Record<StageName, string> = {
  context: 'Gather context',
  plan: 'Plan',
  implement: 'Implement',
  validate: 'Validate',
  submit: 'Submit',
}
