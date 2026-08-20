import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CheckResult, ScriptRule, Violation } from '../types.ts'
import { listFiles, readWorkspace, workingDiff } from '../workspace.ts'
import { allDeclarations } from './ast.ts'

const MARKER = '%%RATCHET%%'

/**
 * Host program for a generated check. Runs in a forked node process with a hard
 * timeout. The check receives an inert, pre-computed snapshot of the codebase —
 * no fs, no net, no shell — so a bad generated check can waste time but cannot
 * damage the repo or reach outside it.
 */
const HOST = `
import { readFileSync } from 'node:fs'
const MARKER = ${JSON.stringify(MARKER)}
const [, , ctxPath, modPath] = process.argv
const data = JSON.parse(readFileSync(ctxPath, 'utf8'))

const globToRegExp = (glob) => {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2 } else { re += '.*'; i += 1 }
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += c.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&')
  }
  return new RegExp('^' + re + '$')
}

const violations = []
const ctx = {
  files: data.files,
  declarations: data.declarations,
  diff: data.diff,
  changedFiles: data.changedFiles,
  glob: (pattern) => { const re = globToRegExp(pattern); return data.files.filter((f) => re.test(f.path)) },
  read: (path) => (data.files.find((f) => f.path === path) || {}).text ?? null,
  lineOf: (text, index) => text.slice(0, index).split('\\n').length,
  violate: (file, detail, extra = {}) => { violations.push({ file, detail, ...extra }) },
}

try {
  const mod = await import(modPath)
  const fn = mod.default
  if (typeof fn !== 'function') throw new Error('check module must export default a function')
  const result = await fn(ctx)
  const merged = [...violations, ...(result && Array.isArray(result.violations) ? result.violations : [])]
  const ok = result && typeof result.ok === 'boolean' ? result.ok && merged.length === 0 : merged.length === 0
  process.stdout.write(MARKER + JSON.stringify({ ok, violations: merged }))
} catch (e) {
  process.stdout.write(MARKER + JSON.stringify({ error: (e && e.stack) || String(e) }))
}
`

export interface ScriptRunOptions {
  timeoutMs?: number
  include?: string[]
  exclude?: string[]
}

export async function runScript(root: string, spec: ScriptRule, opts: ScriptRunOptions = {}): Promise<CheckResult> {
  const started = Date.now()
  const dir = mkdtempSync(join(tmpdir(), 'ratchet-check-'))
  try {
    const files = await readWorkspace(root, opts.include, opts.exclude)
    const paths = await listFiles(root, opts.include, opts.exclude)
    const diff = await workingDiff(root)
    const ctx = {
      files: files.map((f) => ({ path: f.path, text: f.text })),
      declarations: allDeclarations(root, paths),
      diff,
      changedFiles: [...new Set([...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]))],
    }

    const ctxPath = join(dir, 'ctx.json')
    const modPath = join(dir, 'check.mjs')
    const hostPath = join(dir, 'host.mjs')
    writeFileSync(ctxPath, JSON.stringify(ctx))
    writeFileSync(modPath, spec.source)
    writeFileSync(hostPath, HOST)

    const stdout = await new Promise<string>((resolve) => {
      execFile(
        process.execPath,
        ['--no-warnings', hostPath, ctxPath, modPath],
        { timeout: opts.timeoutMs ?? 20_000, maxBuffer: 16 * 1024 * 1024, cwd: dir, env: { PATH: process.env.PATH ?? '' } },
        (err, out, errOut) => {
          if (err && !out.includes(MARKER)) {
            resolve(MARKER + JSON.stringify({ error: String(errOut || err.message).slice(-4000) }))
          } else resolve(out)
        },
      )
    })

    const at = stdout.lastIndexOf(MARKER)
    if (at === -1) return { ok: false, violations: [], error: 'check produced no result', durationMs: Date.now() - started }

    const parsed = JSON.parse(stdout.slice(at + MARKER.length)) as
      | { ok: boolean; violations: Violation[] }
      | { error: string }
    if ('error' in parsed) return { ok: false, violations: [], error: parsed.error, durationMs: Date.now() - started }
    return { ok: parsed.ok, violations: parsed.violations, durationMs: Date.now() - started }
  } catch (e: any) {
    return { ok: false, violations: [], error: e?.message ?? String(e), durationMs: Date.now() - started }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
