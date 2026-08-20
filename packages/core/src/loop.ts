import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Check, Finding, Iteration, Run, StageName, StageRecord } from './types.ts'
import { id, now } from './ids.ts'
import { Store } from './store.ts'
import type { Model } from './model/types.ts'
import { discard, repoRoot, snapshot, workingDiff } from './workspace.ts'
import { runGauntlet } from './checks/runner.ts'
import { inductCheck, recordGauntletStats } from './checks/induct.ts'
import * as builder from './agents/builder.ts'
import { authorCheck, review } from './agents/critic.ts'

const exec = promisify(execFile)

export interface LoopOptions {
  task: string
  cwd: string
  model: Model
  /** Full context→plan→implement→validate→submit passes before we give up. */
  maxIterations?: number
  /** Repair attempts against the gauntlet within a single validate stage. */
  maxRepairs?: number
  /** Commit the result when the run ends clean. */
  commit?: boolean
  onEvent?: (line: string) => void
}

export interface LoopResult {
  run: Run
  newChecks: Check[]
}

/**
 * The Ratchet loop.
 *
 * Five stages per iteration — gather context, plan, implement, validate, submit —
 * with two distinct gates inside `validate`:
 *
 *   1. The GAUNTLET: every check the repo has already earned, run deterministically.
 *      No model is consulted. Failures go straight back to the Builder.
 *   2. The CRITIC: a separate agent that never wrote this code, looking for what the
 *      gauntlet could not see. Anything it finds that is mechanically detectable is
 *      repaired *and then converted into a new check*, so gate 1 is strictly stronger
 *      on the next iteration and in every future run.
 *
 * Gate 2's output is the interesting one: the set of checks grows only in response to
 * defects that actually happened, and each one is proved against the tree that
 * contained the defect before it is allowed to block anything.
 */
export async function runLoop(opts: LoopOptions): Promise<LoopResult> {
  const root = repoRoot(opts.cwd)
  const store = new Store(root)
  store.init()

  const log = (message: string) => opts.onEvent?.(message)
  const maxIterations = opts.maxIterations ?? 4
  const maxRepairs = opts.maxRepairs ?? 3

  const inherited = store.activeChecks()
  const run: Run = {
    id: id('run'),
    task: opts.task,
    cwd: root,
    createdAt: now(),
    endedAt: null,
    status: 'running',
    iterations: [],
    inheritedCheckIds: inherited.map((c) => c.id),
    model: opts.model.name,
    summary: null,
  }
  store.saveRun(run)
  store.emit({ t: now(), type: 'run.start', runId: run.id, task: run.task, inherited: inherited.length })
  log(`run ${run.id} — inheriting ${inherited.length} check(s)`)

  const baseline = await snapshot(root, 'baseline')
  const newChecks: Check[] = []
  let context = ''
  let plan = ''
  let builderSummary = ''

  try {
    for (let i = 0; i < maxIterations; i++) {
      const iteration: Iteration = {
        index: i,
        startedAt: now(),
        endedAt: null,
        stages: {},
        gauntlet: null,
        gauntletAttempts: [],
        findings: [],
        bornCheckIds: [],
        outcome: 'running',
      }
      run.iterations.push(iteration)
      store.emit({ t: now(), type: 'iteration.start', runId: run.id, iteration: i })
      store.saveRun(run)

      const stage = async <T>(name: StageName, fn: () => Promise<{ summary: string; detail?: string; value: T }>): Promise<T> => {
        const rec: StageRecord = { stage: name, startedAt: now(), endedAt: null, summary: '', ok: true }
        iteration.stages[name] = rec
        store.emit({ t: now(), type: 'stage.start', runId: run.id, iteration: i, stage: name })
        log(`  [${i}] ${builder.STAGE_LABEL[name]}…`)
        try {
          const out = await fn()
          rec.summary = out.summary
          rec.detail = out.detail
          rec.endedAt = now()
          store.emit({ t: now(), type: 'stage.end', runId: run.id, iteration: i, stage: name, summary: out.summary, ok: true })
          store.saveRun(run)
          return out.value
        } catch (e: any) {
          rec.ok = false
          rec.summary = e?.message ?? String(e)
          rec.endedAt = now()
          store.emit({ t: now(), type: 'stage.end', runId: run.id, iteration: i, stage: name, summary: rec.summary, ok: false })
          store.saveRun(run)
          throw e
        }
      }

      const bctx: builder.BuilderContext = { task: opts.task, cwd: root, inherited: store.activeChecks() }

      if (i === 0) {
        context = await stage('context', async () => {
          const out = await builder.gatherContext(opts.model, bctx)
          return { summary: firstLine(out), detail: out, value: out }
        })
        plan = await stage('plan', async () => {
          const out = await builder.plan(opts.model, { ...bctx, context })
          return { summary: firstLine(out), detail: out, value: out }
        })
        builderSummary = await stage('implement', async () => {
          const out = await builder.implement(opts.model, { ...bctx, plan })
          return { summary: firstLine(out), detail: out, value: out }
        })
      } else {
        // Subsequent iterations re-implement only what the previous iteration's
        // findings demanded; context and plan carry over.
        iteration.stages.context = skipped('context', 'carried over from iteration 0')
        iteration.stages.plan = skipped('plan', 'carried over from iteration 0')
        builderSummary = await stage('implement', async () => {
          const out = `Repairs applied in iteration ${i - 1}; re-validating.`
          return { summary: out, value: out }
        })
      }

      // ---- validate ------------------------------------------------------
      const validated = await stage('validate', async () => {
        // Gate 1: the gauntlet.
        let gauntlet = await gauntletPass(store, run.id, i, root, log)
        iteration.gauntletAttempts.push(gauntlet)
        let repairs = 0
        while (!gauntlet.passed && repairs < maxRepairs) {
          repairs++
          log(`    gauntlet failed (${gauntlet.failures.length}) — repair ${repairs}/${maxRepairs}`)
          await builder.repairFromGauntlet(opts.model, bctx, gauntlet.failures)
          gauntlet = await gauntletPass(store, run.id, i, root, log)
          iteration.gauntletAttempts.push(gauntlet)
        }
        iteration.gauntlet = gauntlet
        if (!gauntlet.passed) {
          return { summary: `Blocked: ${gauntlet.failures.map((f) => f.check.name).join(', ')}`, value: { gauntlet, findings: [] as Finding[] } }
        }
        const caught = iteration.gauntletAttempts.length - 1

        // Gate 2: the critic.
        const diff = await workingDiff(root)
        const r = await review(opts.model, {
          task: opts.task,
          cwd: root,
          diff,
          builderSummary,
          activeChecks: store.activeChecks(),
        })
        for (const f of r.findings) store.emit({ t: now(), type: 'finding', runId: run.id, iteration: i, finding: f })
        iteration.findings = r.findings
        const det = r.findings.filter((f) => f.deterministic).length
        return {
          summary:
            (caught > 0 ? `Gauntlet caught ${caught} regression pass(es), then green` : `Gauntlet green`) +
            ` (${gauntlet.ran} checks). Critic: ${r.findings.length} finding(s), ${det} deterministic.`,
          detail: r.summary,
          value: { gauntlet, findings: r.findings },
        }
      })

      if (!validated.gauntlet.passed) {
        iteration.outcome = 'blocked'
        iteration.endedAt = now()
        store.emit({ t: now(), type: 'iteration.end', runId: run.id, iteration: i, outcome: 'blocked' })
        run.status = 'failed'
        run.summary = `Blocked by ${validated.gauntlet.failures.map((f) => f.check.name).join(', ')} after ${maxRepairs} repair attempts.`
        break
      }

      if (validated.findings.length === 0) {
        await stage('submit', async () => {
          const out = await submit(root, run, opts.commit ?? false)
          return { summary: out, value: out }
        })
        iteration.outcome = 'clean'
        iteration.endedAt = now()
        store.emit({ t: now(), type: 'iteration.end', runId: run.id, iteration: i, outcome: 'clean' })
        run.status = 'passed'
        run.summary = `Clean after ${i + 1} iteration(s). ${newChecks.filter((c) => c.status === 'active').length} new check(s) earned.`
        break
      }

      // ---- ratchet: repair, then convert every deterministic defect into a check
      iteration.stages.submit = skipped('submit', 'findings outstanding')
      const defectTree = await snapshot(root, 'defect')
      try {
        for (const finding of validated.findings) {
          if (!finding.deterministic) {
            log(`    finding (judgement, not ratcheted): ${finding.title}`)
            continue
          }
          log(`    finding: ${finding.title}`)
          const repairSummary = await builder.repairFromFinding(opts.model, bctx, finding)
          const fixTree = await snapshot(root, 'fix')
          try {
            store.emit({ t: now(), type: 'check.proposed', runId: run.id, iteration: i, name: finding.title, findingId: finding.id })
            const proposal = await authorCheck(opts.model, {
              cwd: root,
              finding,
              repairSummary,
              existing: store.listChecks(),
            })
            const check = await inductCheck(store, proposal, { defect: defectTree, fix: fixTree, baseline }, {
              runId: run.id,
              iteration: i,
              finding,
              author: opts.model.name,
            })
            iteration.bornCheckIds.push(check.id)
            newChecks.push(check)
            log(
              check.status === 'active'
                ? `      ✓ check admitted: ${check.name}`
                : `      ✗ check quarantined: ${check.name} — ${check.evidence?.reason}`,
            )
          } catch (e: any) {
            log(`      ! could not author a check: ${e?.message ?? e}`)
            store.emit({ t: now(), type: 'log', runId: run.id, level: 'warn', message: `check authoring failed for "${finding.title}": ${e?.message ?? e}` })
          } finally {
            discard(fixTree)
          }
        }
      } finally {
        discard(defectTree)
      }

      iteration.outcome = 'repaired'
      iteration.endedAt = now()
      store.emit({ t: now(), type: 'iteration.end', runId: run.id, iteration: i, outcome: 'repaired' })
      store.saveRun(run)
    }

    if (run.status === 'running') {
      run.status = 'failed'
      run.summary = `Exhausted ${maxIterations} iterations without a clean review.`
    }
  } catch (e: any) {
    run.status = 'aborted'
    run.summary = e?.message ?? String(e)
    store.emit({ t: now(), type: 'log', runId: run.id, level: 'error', message: run.summary! })
  } finally {
    discard(baseline)
    run.endedAt = now()
    store.saveRun(run)
    store.emit({ t: now(), type: 'run.end', runId: run.id, status: run.status, summary: run.summary ?? '' })
  }

  return { run, newChecks }
}

async function gauntletPass(store: Store, runId: string, iteration: number, root: string, log: (m: string) => void) {
  const active = store.activeChecks()
  store.emit({ t: now(), type: 'gauntlet.start', runId, iteration, checks: active.length })
  const result = await runGauntlet(root, active, (check, r) => {
    if (!r.ok && !r.error) {
      store.emit({ t: now(), type: 'check.trip', runId, checkId: check.id, checkName: check.name, violations: r.violations.length })
      log(`      ✗ ${check.name}: ${r.violations.length} violation(s)`)
    }
  })
  recordGauntletStats(store, result.results)
  store.emit({
    t: now(),
    type: 'gauntlet.end',
    runId,
    iteration,
    passed: result.passed,
    failures: result.failures.map((f) => f.check.name),
  })
  return result
}

async function submit(root: string, run: Run, commit: boolean): Promise<string> {
  if (!commit) return 'Change left in the working tree (use --commit to have Ratchet commit it).'
  try {
    await exec('git', ['add', '-A'], { cwd: root })
    const message = `${run.task}\n\nRatchet run ${run.id}: gauntlet green, critic clean.`
    await exec('git', ['commit', '-m', message], { cwd: root })
    const { stdout } = await exec('git', ['rev-parse', '--short', 'HEAD'], { cwd: root })
    return `Committed ${stdout.trim()}.`
  } catch (e: any) {
    return `Commit failed: ${(e?.stderr || e?.message || e).toString().trim().slice(0, 300)}`
  }
}

function skipped(stage: StageName, why: string): StageRecord {
  return { stage, startedAt: now(), endedAt: now(), summary: why, ok: true }
}

function firstLine(s: string): string {
  const line = s.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  return line.slice(0, 200)
}
