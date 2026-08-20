import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'

const exec = promisify(execFile)

export interface WorkspaceFile {
  path: string // repo-relative, posix separators
  abs: string
  text: string
}

/** Minimal glob → RegExp. Supports **, *, ?, {a,b} and leading ! is handled by callers. */
export function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` swallows zero or more path segments
        if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2 } else { re += '.*'; i += 1 }
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === '{') {
      const end = glob.indexOf('}', i)
      if (end === -1) re += '\\{'
      else {
        re += '(?:' + glob.slice(i + 1, end).split(',').map(escapeRe).join('|') + ')'
        i = end
      }
    } else re += escapeRe(c)
  }
  return new RegExp(`^${re}$`)
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function matchesAny(path: string, globs: string[] | undefined): boolean {
  if (!globs || globs.length === 0) return false
  return globs.some((g) => globToRegExp(g).test(path))
}

const DEFAULT_INCLUDE = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs']
const ALWAYS_EXCLUDE = ['node_modules/**', '.git/**', '.ratchet/**', '**/dist/**', '**/.next/**', '**/build/**']

/** Read the working tree (tracked + untracked, minus gitignored). Falls back to a walk outside git. */
export async function listFiles(root: string, include?: string[], exclude?: string[]): Promise<string[]> {
  let paths: string[]
  try {
    const { stdout } = await exec('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root, maxBuffer: 32 * 1024 * 1024 })
    paths = stdout.split('\n').filter(Boolean)
  } catch {
    paths = walk(root, root)
  }
  const inc = include && include.length ? include : DEFAULT_INCLUDE
  return paths
    .map((p) => p.split(sep).join('/'))
    .filter((p) => !matchesAny(p, ALWAYS_EXCLUDE))
    .filter((p) => matchesAny(p, inc))
    .filter((p) => !matchesAny(p, exclude))
    .filter((p) => { const abs = join(root, p); return existsSync(abs) && statSync(abs).isFile() })
    .sort()
}

function walk(root: string, dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', '.git', '.next', 'dist', 'build', '.ratchet'].includes(entry.name)) continue
      walk(root, abs, out)
    } else out.push(relative(root, abs))
  }
  return out
}

export async function readWorkspace(root: string, include?: string[], exclude?: string[]): Promise<WorkspaceFile[]> {
  const paths = await listFiles(root, include, exclude)
  return paths.map((p) => {
    const abs = join(root, p)
    return { path: p, abs, text: readFileSync(abs, 'utf8') }
  })
}

/**
 * Copy the working tree (respecting .gitignore) to a temp dir. Used to freeze the
 * "defective" and "repaired" trees so a newly authored check can be proved against
 * both before it is allowed into the registry.
 */
export async function snapshot(root: string, label: string): Promise<string> {
  const dest = mkdtempSync(join(tmpdir(), `ratchet-${label}-`))
  let paths: string[]
  try {
    const { stdout } = await exec('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root, maxBuffer: 32 * 1024 * 1024 })
    paths = stdout.split('\n').filter(Boolean)
  } catch {
    paths = walk(root, root)
  }
  for (const p of paths) {
    const src = join(root, p)
    if (!existsSync(src) || !statSync(src).isFile()) continue
    const dst = join(dest, p)
    mkdirSync(dirname(dst), { recursive: true })
    cpSync(src, dst)
  }
  return dest
}

export function discard(dir: string): void {
  if (dir.startsWith(tmpdir())) rmSync(dir, { recursive: true, force: true })
}

/** Unified diff of the working tree vs HEAD, for the Critic to review. */
export async function workingDiff(root: string, maxBytes = 200_000): Promise<string> {
  try {
    const { stdout } = await exec('git', ['diff', 'HEAD', '--', '.'], { cwd: root, maxBuffer: 32 * 1024 * 1024 })
    const { stdout: untracked } = await exec('git', ['ls-files', '-o', '--exclude-standard'], { cwd: root })
    let out = stdout
    for (const p of untracked.split('\n').filter(Boolean)) {
      if (matchesAny(p, ALWAYS_EXCLUDE)) continue
      const abs = join(root, p)
      if (!existsSync(abs) || !statSync(abs).isFile()) continue
      out += `\n--- /dev/null\n+++ b/${p}\n` + readFileSync(abs, 'utf8').split('\n').map((l) => '+' + l).join('\n') + '\n'
    }
    return out.slice(0, maxBytes)
  } catch {
    return ''
  }
}

export function repoRoot(cwd: string): string {
  let d = resolve(cwd)
  while (d !== dirname(d)) {
    if (existsSync(join(d, '.git'))) return d
    d = dirname(d)
  }
  return resolve(cwd)
}
