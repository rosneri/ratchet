import type { AdmissionEvidence, Check, CheckSpec, CheckStatus, Finding } from '../types.ts'
import { id, now, slug } from '../ids.ts'
import type { Store } from '../store.ts'
import { runCheck } from './runner.ts'

export interface ProposedCheck {
  name: string
  title: string
  message: string
  severity: 'error' | 'warn'
  spec: CheckSpec
}

export interface Trees {
  /** The tree as the Builder left it, before the defect was repaired. */
  defect: string
  /** The tree after the repair. */
  fix: string
  /** The tree as it was when the run started. */
  baseline: string
}

/**
 * Admission control — the part that makes this a ratchet rather than a pile of
 * plausible-sounding lint rules.
 *
 * A proposed check must clear three gates against frozen snapshots:
 *
 *   1. It FAILS on the defective tree. Without this, the check is decorative: it
 *      would not have caught the very bug that motivated it.
 *   2. It PASSES on the repaired tree. Without this, the check is a false positive
 *      generator that would wedge every future iteration.
 *   3. It PASSES on the run's baseline tree. Without this, we would be retroactively
 *      condemning code that was already there and blocking unrelated work.
 *
 * Anything that fails a gate is written to disk as `quarantined` — visible in the
 * UI, never executed. Quarantined checks are as informative as admitted ones: they
 * show where the Critic reached for a rule it could not actually justify.
 */
export async function inductCheck(
  store: Store,
  proposal: ProposedCheck,
  trees: Trees,
  provenance: { runId: string; iteration: number; finding: Finding; author: string },
): Promise<Check> {
  const started = Date.now()

  const onDefect = await runCheck(trees.defect, asCheck(proposal))
  const onFix = await runCheck(trees.fix, asCheck(proposal))
  const onBaseline = await runCheck(trees.baseline, asCheck(proposal))

  const errored = onDefect.error ?? onFix.error ?? onBaseline.error
  const failedOnDefect = !onDefect.ok && !onDefect.error
  const passedOnFix = onFix.ok
  const passedOnBaseline = onBaseline.ok

  let admitted = false
  let reason: string
  if (errored) {
    reason = `Check errored during admission: ${errored.split('\n')[0]}`
  } else if (!failedOnDefect) {
    reason = 'Rejected: the check passes on the defective tree, so it would not have caught this bug.'
  } else if (!passedOnFix) {
    reason = `Rejected: the check still fails after the repair (${onFix.violations.length} violation(s)) — false positive.`
  } else if (!passedOnBaseline) {
    reason = `Rejected: the check fails on the run baseline (${onBaseline.violations.length} violation(s)) — it would condemn pre-existing code and block unrelated work.`
  } else {
    admitted = true
    reason = `Admitted: caught ${onDefect.violations.length} violation(s) on the defective tree, clean on the repair and on the baseline.`
  }

  const evidence: AdmissionEvidence = {
    failedOnDefect,
    passedOnFix,
    passedOnBaseline,
    defectViolations: onDefect.violations,
    fixViolations: onFix.violations,
    baselineViolations: onBaseline.violations,
    durationMs: Date.now() - started,
    admitted,
    reason,
  }

  const name = store.uniqueCheckName(slug(proposal.name))
  const status: CheckStatus = admitted ? 'active' : 'quarantined'

  const check: Check = {
    id: id('chk'),
    name,
    title: proposal.title,
    message: proposal.message,
    severity: proposal.severity,
    spec: proposal.spec,
    status,
    provenance: {
      runId: provenance.runId,
      iteration: provenance.iteration,
      findingId: provenance.finding.id,
      because: provenance.finding.detail,
      witnesses: provenance.finding.files,
      createdAt: now(),
      author: provenance.author,
    },
    evidence,
    stats: { runs: 0, trips: 0, lastTrippedAt: null, errors: 0, avgDurationMs: onFix.durationMs },
  }

  store.saveCheck(check)
  store.emit(
    admitted
      ? { t: now(), type: 'check.admitted', runId: provenance.runId, checkId: check.id, name: check.name, because: check.provenance.because }
      : { t: now(), type: 'check.quarantined', runId: provenance.runId, checkId: check.id, name: check.name, reason },
  )
  return check
}

function asCheck(p: ProposedCheck): Check {
  return {
    id: 'candidate',
    name: p.name,
    title: p.title,
    message: p.message,
    severity: p.severity,
    spec: p.spec,
    status: 'active',
    provenance: { runId: '', iteration: 0, findingId: '', because: '', witnesses: [], createdAt: now(), author: '' },
    evidence: null,
    stats: { runs: 0, trips: 0, lastTrippedAt: null, errors: 0, avgDurationMs: 0 },
  }
}

/** Fold a gauntlet outcome back into each check's running statistics. */
export function recordGauntletStats(
  store: Store,
  results: Array<{ check: Check; result: { ok: boolean; violations: unknown[]; error?: string; durationMs: number } }>,
): void {
  for (const { check, result } of results) {
    const stored = store.getCheck(check.id) ?? check
    stored.stats.runs += 1
    stored.stats.avgDurationMs = Math.round(
      (stored.stats.avgDurationMs * (stored.stats.runs - 1) + result.durationMs) / stored.stats.runs,
    )
    if (result.error) stored.stats.errors += 1
    else stored.stats.errors = 0
    if (!result.ok && !result.error) {
      stored.stats.trips += 1
      stored.stats.lastTrippedAt = now()
    }
    // A check that errors repeatedly is worse than no check: it makes the gauntlet
    // unreliable without ever telling us anything. Retire it and surface it in the UI.
    if (stored.stats.errors >= 3 && stored.status === 'active') stored.status = 'retired'
    store.saveCheck(stored)
  }
}
