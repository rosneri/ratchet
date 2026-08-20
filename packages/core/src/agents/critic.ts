import type { Model } from '../model/types.ts'
import { extractJson } from '../model/types.ts'
import type { Check, Finding } from '../types.ts'
import { id } from '../ids.ts'
import { AUTHOR_SYSTEM, CRITIC_SYSTEM } from './prompts.ts'
import type { ProposedCheck } from '../checks/induct.ts'

export interface ReviewInput {
  task: string
  cwd: string
  diff: string
  builderSummary: string
  activeChecks: Check[]
}

export interface Review {
  summary: string
  findings: Finding[]
}

export async function review(model: Model, input: ReviewInput): Promise<Review> {
  const existing = input.activeChecks.length
    ? input.activeChecks.map((c) => `- ${c.name}: ${c.title}`).join('\n')
    : '(none yet)'

  const reply = await model.run({
    role: 'critic',
    system: CRITIC_SYSTEM,
    cwd: input.cwd,
    tools: 'read-only',
    prompt: `Task the Builder was given:
${input.task}

What the Builder says it did:
${input.builderSummary}

Checks that already passed on this change — do not re-report anything these cover:
${existing}

The diff:
${input.diff || '(empty diff)'}

Read whatever surrounding code you need. Then review.`,
  })

  const parsed = extractJson<{ summary?: string; findings?: Array<Partial<Finding>> }>(reply.text)
  const findings: Finding[] = (parsed.findings ?? []).map((f) => ({
    id: id('fnd'),
    title: f.title ?? 'Untitled finding',
    detail: f.detail ?? '',
    severity: f.severity === 'warn' ? 'warn' : 'error',
    files: f.files ?? [],
    deterministic: f.deterministic === true,
    checkIdea: f.checkIdea ?? null,
  }))
  return { summary: parsed.summary ?? '', findings }
}

export interface AuthorInput {
  cwd: string
  finding: Finding
  repairSummary: string
  /** Checks already in the registry — the Author must not duplicate one. */
  existing: Check[]
}

export async function authorCheck(model: Model, input: AuthorInput): Promise<ProposedCheck> {
  const existing = input.existing.length
    ? input.existing.map((c) => `- ${c.name}: ${c.title} (${JSON.stringify(c.spec.rule)})`).join('\n')
    : '(none)'

  const reply = await model.run({
    role: 'author',
    system: AUTHOR_SYSTEM,
    cwd: input.cwd,
    tools: 'read-only',
    prompt: `The defect:
  ${input.finding.title}
  ${input.finding.detail}
  Files: ${input.finding.files.join(', ') || '(unspecified)'}
  Critic's sketch of a check: ${input.finding.checkIdea ?? '(none given)'}

How it was repaired:
${input.repairSummary}

Checks already in the registry — do not duplicate one of these:
${existing}

Inspect the repaired code so your check matches what is actually there now, then
write the check.`,
  })

  const parsed = extractJson<Partial<ProposedCheck>>(reply.text)
  if (!parsed.spec || typeof parsed.spec !== 'object' || !('rule' in parsed.spec)) {
    throw new Error(`Check author returned no valid spec:\n${reply.text.slice(0, 800)}`)
  }
  return {
    name: parsed.name ?? 'unnamed-check',
    title: parsed.title ?? parsed.name ?? 'Unnamed check',
    message: parsed.message ?? 'This check was violated.',
    severity: parsed.severity === 'warn' ? 'warn' : 'error',
    spec: parsed.spec as ProposedCheck['spec'],
  }
}
