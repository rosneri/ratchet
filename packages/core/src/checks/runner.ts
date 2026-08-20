import type { Check, CheckResult, GauntletResult } from '../types.ts'
import { runBuiltin } from './builtin.ts'
import { runScript } from './script.ts'

export async function runCheck(root: string, check: Check): Promise<CheckResult> {
  if (check.spec.rule === 'script') return runScript(root, check.spec)
  return runBuiltin(root, check.spec)
}

/**
 * The gauntlet: every admitted check, run against a tree. This is the only gate
 * that can stop an iteration — no model opinion is involved.
 */
export async function runGauntlet(
  root: string,
  checks: Check[],
  onResult?: (check: Check, result: CheckResult) => void,
): Promise<GauntletResult> {
  const started = Date.now()
  const results: GauntletResult['results'] = []

  // Cheap rules first so an obvious regression fails fast before we shell out to
  // type-checkers and test suites.
  const ordered = [...checks].sort((a, b) => cost(a) - cost(b))

  for (const check of ordered) {
    const result = await runCheck(root, check)
    results.push({ check, result })
    onResult?.(check, result)
  }

  const failures = results.filter((r) => !r.result.ok)
  return {
    passed: failures.length === 0,
    ran: results.length,
    results,
    failures,
    durationMs: Date.now() - started,
  }
}

function cost(check: Check): number {
  switch (check.spec.rule) {
    case 'forbid-pattern':
    case 'require-pattern':
    case 'forbid-paths':
    case 'forbid-import':
      return 0
    case 'no-duplicate-symbol':
    case 'canonical-symbol':
      return 1
    case 'script':
      return 2
    case 'command':
      return 3
    default:
      return 4
  }
}
