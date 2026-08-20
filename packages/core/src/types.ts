/**
 * Ratchet core domain types.
 *
 * The central idea: a check is never predefined. Every check in the registry was
 * authored by the Critic during a real task, in response to a real defect, and was
 * admitted only after proving it (a) fails on the defective tree and (b) passes on
 * the repaired tree. Checks only ever tighten — hence "ratchet".
 */

export type StageName = 'context' | 'plan' | 'implement' | 'validate' | 'submit'

export const STAGES: StageName[] = ['context', 'plan', 'implement', 'validate', 'submit']

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Built-in, parameterised rules. Fast, safe, no code generation involved. */
export type BuiltinRule =
  | { rule: 'no-duplicate-symbol'; kinds?: SymbolKind[]; include?: string[]; exclude?: string[] }
  | { rule: 'forbid-pattern'; pattern: string; flags?: string; include?: string[]; exclude?: string[]; hint?: string }
  | { rule: 'require-pattern'; pattern: string; flags?: string; include: string[]; hint?: string }
  | { rule: 'forbid-import'; module: string; include?: string[]; exclude?: string[]; hint?: string }
  | { rule: 'canonical-symbol'; symbol: string; declaredIn: string; hint?: string }
  | { rule: 'forbid-paths'; globs: string[]; hint?: string }
  | { rule: 'command'; command: string; args?: string[]; expectExitCode?: number; timeoutMs?: number }

export type SymbolKind = 'function' | 'class' | 'interface' | 'type' | 'enum' | 'const' | 'export'

/**
 * A generated check: a real JS module written by the Critic at task time.
 * Executed in a forked child process with a hard timeout and a read-only context.
 */
export interface ScriptRule {
  rule: 'script'
  /** ESM source. Must `export default async function check(ctx) -> CheckResult`. */
  source: string
  /** Human-readable statement of what the script asserts. */
  asserts: string
}

export type CheckSpec = BuiltinRule | ScriptRule

export type CheckStatus =
  /** Admitted: proved it catches the defect and clears the fix. Runs on every gauntlet. */
  | 'active'
  /** Failed admission (didn't detect the defect, or false-positived on the fix). Kept for audit, not run. */
  | 'quarantined'
  /** Manually or automatically retired (e.g. superseded, or too flaky). */
  | 'retired'

export interface CheckProvenance {
  /** Run in which this check was born. */
  runId: string
  /** Iteration index within that run. */
  iteration: number
  /** The Critic finding that triggered authoring. */
  findingId: string
  /** Plain-English account of the defect that motivated the check. */
  because: string
  /** Files implicated in the original defect. */
  witnesses: string[]
  createdAt: string
  /** Model that authored the check. */
  author: string
}

export interface AdmissionEvidence {
  /** Did the check fail on the defective tree? (required: proves detection) */
  failedOnDefect: boolean
  /** Did the check pass on the repaired tree? (required: proves no false positive) */
  passedOnFix: boolean
  /** Did it pass against the run's baseline tree? (guards against retroactively breaking the repo) */
  passedOnBaseline: boolean
  defectViolations: Violation[]
  fixViolations: Violation[]
  baselineViolations: Violation[]
  durationMs: number
  admitted: boolean
  reason: string
}

export interface Check {
  id: string
  /** Stable kebab-case name, e.g. `no-duplicate-format-money`. */
  name: string
  title: string
  /** What a violation means and how to fix it — shown to the Builder when it trips. */
  message: string
  severity: 'error' | 'warn'
  spec: CheckSpec
  status: CheckStatus
  provenance: CheckProvenance
  evidence: AdmissionEvidence | null
  stats: {
    /** How many gauntlet runs this check has participated in. */
    runs: number
    /** How many times it caught something. Every trip is a regression that did NOT ship. */
    trips: number
    lastTrippedAt: string | null
    /** Consecutive gauntlets where it errored out (not violated — errored). */
    errors: number
    avgDurationMs: number
  }
}

// ---------------------------------------------------------------------------
// Check execution
// ---------------------------------------------------------------------------

export interface Violation {
  file: string
  line?: number
  column?: number
  excerpt?: string
  detail: string
}

export interface CheckResult {
  ok: boolean
  violations: Violation[]
  /** Set when the check itself blew up. An errored check is not a violation. */
  error?: string
  durationMs: number
}

export interface GauntletResult {
  passed: boolean
  ran: number
  results: Array<{ check: Check; result: CheckResult }>
  failures: Array<{ check: Check; result: CheckResult }>
  durationMs: number
}

// ---------------------------------------------------------------------------
// Critic findings
// ---------------------------------------------------------------------------

export interface Finding {
  id: string
  title: string
  /** Why this is wrong, concretely. */
  detail: string
  severity: 'error' | 'warn'
  files: string[]
  /**
   * True when the defect is mechanically detectable — the Critic must then author
   * a check. False for genuinely judgement-bound issues (naming taste, product
   * decisions), which are reported but never ratcheted.
   */
  deterministic: boolean
  /** The Critic's plan for how a deterministic check would catch this. */
  checkIdea: string | null
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export interface Iteration {
  index: number
  startedAt: string
  endedAt: string | null
  stages: Partial<Record<StageName, StageRecord>>
  /** The last gauntlet pass of this iteration — green if the iteration got past gate 1. */
  gauntlet: GauntletResult | null
  /** Every gauntlet pass, in order. Earlier failing passes are the regressions the ratchet caught. */
  gauntletAttempts: GauntletResult[]
  findings: Finding[]
  /** Checks born during this iteration (admitted or quarantined). */
  bornCheckIds: string[]
  outcome: 'clean' | 'repaired' | 'blocked' | 'running'
}

export interface StageRecord {
  stage: StageName
  startedAt: string
  endedAt: string | null
  summary: string
  detail?: string
  tokens?: number
  ok: boolean
}

export interface Run {
  id: string
  task: string
  cwd: string
  createdAt: string
  endedAt: string | null
  status: 'running' | 'passed' | 'failed' | 'aborted'
  iterations: Iteration[]
  /** Checks active at the moment the run started — the inherited ratchet. */
  inheritedCheckIds: string[]
  model: string
  summary: string | null
}

// ---------------------------------------------------------------------------
// Events (append-only log; the UI tails this)
// ---------------------------------------------------------------------------

export type RatchetEvent =
  | { t: string; type: 'run.start'; runId: string; task: string; inherited: number }
  | { t: string; type: 'run.end'; runId: string; status: Run['status']; summary: string }
  | { t: string; type: 'iteration.start'; runId: string; iteration: number }
  | { t: string; type: 'iteration.end'; runId: string; iteration: number; outcome: Iteration['outcome'] }
  | { t: string; type: 'stage.start'; runId: string; iteration: number; stage: StageName }
  | { t: string; type: 'stage.end'; runId: string; iteration: number; stage: StageName; summary: string; ok: boolean }
  | { t: string; type: 'gauntlet.start'; runId: string; iteration: number; checks: number }
  | { t: string; type: 'gauntlet.end'; runId: string; iteration: number; passed: boolean; failures: string[] }
  | { t: string; type: 'check.trip'; runId: string; checkId: string; checkName: string; violations: number }
  | { t: string; type: 'finding'; runId: string; iteration: number; finding: Finding }
  | { t: string; type: 'check.proposed'; runId: string; iteration: number; name: string; findingId: string }
  | { t: string; type: 'check.admitted'; runId: string; checkId: string; name: string; because: string }
  | { t: string; type: 'check.quarantined'; runId: string; checkId: string; name: string; reason: string }
  | { t: string; type: 'log'; runId: string; level: 'info' | 'warn' | 'error'; message: string }
