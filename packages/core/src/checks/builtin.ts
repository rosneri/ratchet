import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { BuiltinRule, CheckResult, Violation } from '../types.ts'
import { listFiles, matchesAny, readWorkspace } from '../workspace.ts'
import { allDeclarations } from './ast.ts'

const exec = promisify(execFile)

/**
 * Parameterised rules. These are the primitives the Critic reaches for first — no
 * code generation, so nothing to sandbox and nothing to review. When none of them
 * can express the invariant, the Critic falls back to a `script` check.
 */
export async function runBuiltin(root: string, spec: BuiltinRule): Promise<CheckResult> {
  const started = Date.now()
  const done = (violations: Violation[], error?: string): CheckResult => ({
    ok: violations.length === 0 && !error,
    violations,
    error,
    durationMs: Date.now() - started,
  })

  try {
    switch (spec.rule) {
      case 'no-duplicate-symbol': {
        const files = await listFiles(root, spec.include, spec.exclude)
        const decls = allDeclarations(root, files).filter((d) => !spec.kinds || spec.kinds.includes(d.kind))
        const byName = new Map<string, typeof decls>()
        for (const d of decls) {
          const arr = byName.get(d.name) ?? []
          arr.push(d)
          byName.set(d.name, arr)
        }
        const violations: Violation[] = []
        for (const [name, group] of byName) {
          if (group.length < 2) continue
          for (const d of group) {
            violations.push({
              file: d.file,
              line: d.line,
              detail: `\`${name}\` (${d.kind}) is declared ${group.length} times: ${group.map((g) => `${g.file}:${g.line}`).join(', ')}`,
            })
          }
        }
        return done(violations)
      }

      case 'canonical-symbol': {
        const files = await listFiles(root)
        const decls = allDeclarations(root, files).filter((d) => d.name === spec.symbol)
        const canonical = spec.declaredIn.split('\\').join('/')
        const violations: Violation[] = decls
          .filter((d) => d.file !== canonical)
          .map((d) => ({
            file: d.file,
            line: d.line,
            excerpt: d.text.split('\n')[0],
            detail: `\`${spec.symbol}\` must be declared only in ${canonical}; found a second declaration here. Import it instead.`,
          }))
        // If the canonical declaration vanished entirely, that is also a violation.
        if (decls.length > 0 && !decls.some((d) => d.file === canonical)) {
          violations.push({ file: canonical, detail: `Canonical declaration of \`${spec.symbol}\` is missing from ${canonical}.` })
        }
        return done(violations)
      }

      case 'forbid-pattern': {
        const files = await readWorkspace(root, spec.include, spec.exclude)
        const re = new RegExp(spec.pattern, ensureFlags(spec.flags, 'g'))
        const violations: Violation[] = []
        for (const f of files) {
          re.lastIndex = 0
          for (const m of f.text.matchAll(re)) {
            const line = f.text.slice(0, m.index ?? 0).split('\n').length
            violations.push({
              file: f.path,
              line,
              excerpt: f.text.split('\n')[line - 1]?.trim().slice(0, 160),
              detail: spec.hint ?? `Forbidden pattern /${spec.pattern}/ matched.`,
            })
          }
        }
        return done(violations)
      }

      case 'require-pattern': {
        const files = await readWorkspace(root, spec.include)
        const re = new RegExp(spec.pattern, ensureFlags(spec.flags, ''))
        const violations: Violation[] = files
          .filter((f) => !re.test(f.text))
          .map((f) => ({ file: f.path, detail: spec.hint ?? `Required pattern /${spec.pattern}/ is absent.` }))
        return done(violations)
      }

      case 'forbid-import': {
        const files = await readWorkspace(root, spec.include, spec.exclude)
        const target = spec.module
        const violations: Violation[] = []
        const re = /(?:import\s[^'"]*from\s*|import\s*|require\s*\(\s*|import\s*\(\s*)['"]([^'"]+)['"]/g
        for (const f of files) {
          for (const m of f.text.matchAll(re)) {
            if (m[1] !== target && !m[1].startsWith(target + '/')) continue
            const line = f.text.slice(0, m.index ?? 0).split('\n').length
            violations.push({ file: f.path, line, excerpt: m[0], detail: spec.hint ?? `Import of \`${target}\` is not allowed here.` })
          }
        }
        return done(violations)
      }

      case 'forbid-paths': {
        const files = await listFiles(root, ['**/*'])
        const violations: Violation[] = files
          .filter((p) => matchesAny(p, spec.globs))
          .map((p) => ({ file: p, detail: spec.hint ?? `File matches a forbidden path pattern.` }))
        return done(violations)
      }

      case 'command': {
        const expect = spec.expectExitCode ?? 0
        try {
          await exec(spec.command, spec.args ?? [], { cwd: root, timeout: spec.timeoutMs ?? 120_000, maxBuffer: 16 * 1024 * 1024 })
          return done(expect === 0 ? [] : [{ file: '.', detail: `\`${cmdLine(spec)}\` exited 0 but ${expect} was expected.` }])
        } catch (e: any) {
          const code = typeof e?.code === 'number' ? e.code : 1
          if (code === expect) return done([])
          const output = `${e?.stdout ?? ''}${e?.stderr ?? ''}`.trim().slice(-4000)
          return done([{ file: '.', detail: `\`${cmdLine(spec)}\` exited ${code}\n${output}` }])
        }
      }
    }
  } catch (e: any) {
    return done([], e?.message ?? String(e))
  }
  return done([], 'unknown builtin rule')
}

function cmdLine(spec: Extract<BuiltinRule, { rule: 'command' }>): string {
  return [spec.command, ...(spec.args ?? [])].join(' ')
}

function ensureFlags(flags: string | undefined, required: string): string {
  const set = new Set([...(flags ?? ''), ...required])
  return [...set].join('')
}
