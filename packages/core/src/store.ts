import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Check, RatchetEvent, Run } from './types.ts'

/**
 * On-disk state lives in `.ratchet/` inside the target repo, so the ratchet travels
 * with the codebase: clone the repo, inherit every check the project has ever earned.
 *
 *   .ratchet/
 *     checks/<name>.json      one file per check — reviewable, diffable, git-tracked
 *     runs/<runId>.json       full run transcript
 *     events.jsonl            append-only event log (the UI tails this)
 */
export class Store {
  readonly root: string
  readonly dir: string

  constructor(root: string) {
    this.root = resolve(root)
    this.dir = join(this.root, '.ratchet')
  }

  init(): void {
    for (const d of [this.dir, join(this.dir, 'checks'), join(this.dir, 'runs'), join(this.dir, 'tmp')]) {
      if (!existsSync(d)) mkdirSync(d, { recursive: true })
    }
    const gi = join(this.dir, '.gitignore')
    if (!existsSync(gi)) writeFileSync(gi, 'tmp/\n')
  }

  // -- checks ---------------------------------------------------------------

  checkPath(name: string): string {
    return join(this.dir, 'checks', `${name}.json`)
  }

  listChecks(): Check[] {
    const dir = join(this.dir, 'checks')
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Check)
      .sort((a, b) => a.provenance.createdAt.localeCompare(b.provenance.createdAt))
  }

  activeChecks(): Check[] {
    return this.listChecks().filter((c) => c.status === 'active')
  }

  getCheck(nameOrId: string): Check | null {
    return this.listChecks().find((c) => c.name === nameOrId || c.id === nameOrId) ?? null
  }

  saveCheck(check: Check): void {
    this.init()
    writeFileSync(this.checkPath(check.name), JSON.stringify(check, null, 2) + '\n')
  }

  /** Ensure a unique check name, appending -2, -3 ... on collision. */
  uniqueCheckName(base: string): string {
    let name = base
    let n = 2
    while (existsSync(this.checkPath(name))) name = `${base}-${n++}`
    return name
  }

  // -- runs -----------------------------------------------------------------

  listRuns(): Run[] {
    const dir = join(this.dir, 'runs')
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Run)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  getRun(runId: string): Run | null {
    const p = join(this.dir, 'runs', `${runId}.json`)
    return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Run) : null
  }

  saveRun(run: Run): void {
    this.init()
    writeFileSync(join(this.dir, 'runs', `${run.id}.json`), JSON.stringify(run, null, 2) + '\n')
  }

  // -- events ---------------------------------------------------------------

  emit(event: RatchetEvent): void {
    this.init()
    appendFileSync(join(this.dir, 'events.jsonl'), JSON.stringify(event) + '\n')
  }

  readEvents(limit = 2000): RatchetEvent[] {
    const p = join(this.dir, 'events.jsonl')
    if (!existsSync(p)) return []
    const lines = readFileSync(p, 'utf8').trim().split('\n').filter(Boolean)
    return lines.slice(-limit).map((l) => JSON.parse(l) as RatchetEvent)
  }
}
