import { Store } from '@ratchet/core/store'
import type { Check, RatchetEvent, Run } from '@ratchet/core/types'
import { resolve } from 'node:path'

/**
 * The UI reads the same `.ratchet/` directory the CLI writes. There is no server,
 * no database and no sync step — the registry is files in the repo, which is also
 * what makes it reviewable in a pull request.
 */
export function root(): string {
  return resolve(process.env.RATCHET_ROOT ?? process.cwd())
}

export function store(): Store {
  return new Store(root())
}

export interface Overview {
  checks: Check[]
  active: Check[]
  runs: Run[]
  events: RatchetEvent[]
  totals: {
    active: number
    quarantined: number
    retired: number
    trips: number
    runs: number
    generated: number
    builtin: number
  }
}

export function overview(): Overview {
  const s = store()
  const checks = s.listChecks()
  const runs = s.listRuns()
  return {
    checks,
    active: checks.filter((c) => c.status === 'active'),
    runs,
    events: s.readEvents(400),
    totals: {
      active: checks.filter((c) => c.status === 'active').length,
      quarantined: checks.filter((c) => c.status === 'quarantined').length,
      retired: checks.filter((c) => c.status === 'retired').length,
      trips: checks.reduce((n, c) => n + c.stats.trips, 0),
      runs: runs.length,
      generated: checks.filter((c) => c.spec.rule === 'script').length,
      builtin: checks.filter((c) => c.spec.rule !== 'script').length,
    },
  }
}

export function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.round(ms / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.round(hr / 24)}d ago`
}

export function duration(from: string, to: string | null): string {
  if (!to) return '—'
  const ms = new Date(to).getTime() - new Date(from).getTime()
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
