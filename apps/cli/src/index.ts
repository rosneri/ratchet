import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { ClaudeModel, Store, repoRoot, runGauntlet, runLoop, type Check } from '@ratchet/core'
import { bold, cyan, dim, green, heading, magenta, red, statusDot, yellow } from './format.ts'
import { runDemo } from './demo.ts'

const argv = process.argv.slice(2)
const command = argv[0] ?? 'help'

function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  if (i === -1) return undefined
  const next = argv[i + 1]
  return next && !next.startsWith('--') ? next : 'true'
}

function has(name: string): boolean {
  return argv.includes(`--${name}`)
}

const cwd = resolve(flag('cwd') ?? process.cwd())

async function main(): Promise<number> {
  switch (command) {
    case 'run':
      return cmdRun()
    case 'gauntlet':
      return cmdGauntlet()
    case 'checks':
      return cmdChecks()
    case 'check':
      return cmdCheck()
    case 'runs':
      return cmdRuns()
    case 'demo':
      return cmdDemo()
    case 'help':
    case '--help':
    case '-h':
      usage()
      return 0
    default:
      console.error(red(`Unknown command: ${command}\n`))
      usage()
      return 1
  }
}

function usage(): void {
  console.log(`
${bold('ratchet')} — one agent works, another scrutinises, and every real defect
becomes a deterministic check so it cannot happen twice.

${bold('Commands')}
  ${cyan('ratchet run "<task>"')}       Run the five-stage loop on the current repo
  ${cyan('ratchet gauntlet')}           Run every earned check against the working tree
  ${cyan('ratchet checks')}             List the checks this repo has earned
  ${cyan('ratchet check <name>')}       Show one check: provenance, admission evidence, source
  ${cyan('ratchet runs')}               List past runs
  ${cyan('ratchet demo')}               Build a fixture repo and run the loop with no API key

${bold('Flags')}
  --cwd <path>              Target repository (default: cwd)
  --commit                  Commit when the run ends clean
  --max-iterations <n>      Loop passes before giving up (default 4)
  --all                     Include quarantined and retired checks
  --json                    Machine-readable output

${dim('The UI lives in apps/web: RATCHET_ROOT=<repo> npm run web')}
`)
}

async function cmdRun(): Promise<number> {
  const task = argv.slice(1).find((a) => !a.startsWith('--'))
  if (!task) {
    console.error(red('Give me a task: ratchet run "add an invoice renderer"'))
    return 1
  }
  const model = new ClaudeModel()
  console.log(heading(`ratchet run`))
  console.log(`${dim('task ')}${task}`)
  console.log(`${dim('repo ')}${repoRoot(cwd)}`)
  console.log(`${dim('model')} ${model.name}\n`)

  const { run, newChecks } = await runLoop({
    task,
    cwd,
    model,
    commit: has('commit'),
    maxIterations: Number(flag('max-iterations') ?? 4),
    onEvent: (line) => console.log(line),
  })

  console.log(heading('result'))
  console.log(`${statusDot(run.status)} ${bold(run.status)} — ${run.summary ?? ''}`)
  const admitted = newChecks.filter((c) => c.status === 'active')
  const quarantined = newChecks.filter((c) => c.status !== 'active')
  if (admitted.length) {
    console.log(`\n${bold('Checks earned in this run')} ${dim('— these now run on every future change')}`)
    for (const c of admitted) console.log(`  ${green('+')} ${bold(c.name)} ${dim('·')} ${c.title}\n      ${dim(c.provenance.because.slice(0, 160))}`)
  }
  if (quarantined.length) {
    console.log(`\n${bold('Proposed but not admitted')} ${dim('— failed to prove themselves')}`)
    for (const c of quarantined) console.log(`  ${red('-')} ${c.name} ${dim('·')} ${c.evidence?.reason ?? ''}`)
  }
  return run.status === 'passed' ? 0 : 1
}

async function cmdGauntlet(): Promise<number> {
  const root = repoRoot(cwd)
  const store = new Store(root)
  const checks = store.activeChecks()
  if (checks.length === 0) {
    console.log(dim('No checks earned yet. Run `ratchet run "<task>"` or `ratchet demo`.'))
    return 0
  }
  console.log(heading(`gauntlet · ${checks.length} check(s)`))
  const result = await runGauntlet(root, checks, (check, r) => {
    const mark = r.error ? yellow('!') : r.ok ? green('✓') : red('✗')
    console.log(`  ${mark} ${check.name} ${dim(`${r.durationMs}ms`)}`)
    if (r.error) console.log(`      ${yellow(r.error.split('\n')[0])}`)
    for (const v of r.violations.slice(0, 10)) {
      console.log(`      ${red(v.file + (v.line ? `:${v.line}` : ''))} ${v.detail}`)
      if (v.excerpt) console.log(`        ${dim('> ' + v.excerpt)}`)
    }
  })
  console.log(
    `\n${result.passed ? green('gauntlet passed') : red('gauntlet failed')} ${dim(`(${result.ran} checks, ${result.durationMs}ms)`)}`,
  )
  return result.passed ? 0 : 1
}

async function cmdChecks(): Promise<number> {
  const store = new Store(repoRoot(cwd))
  const all = store.listChecks()
  const checks = has('all') ? all : all.filter((c) => c.status === 'active')
  if (has('json')) {
    console.log(JSON.stringify(checks, null, 2))
    return 0
  }
  if (checks.length === 0) {
    console.log(dim('No checks yet — this repo has not earned any.'))
    return 0
  }
  console.log(heading(`checks · ${checks.length}`))
  for (const c of checks) {
    console.log(
      `${statusDot(c.status)} ${bold(c.name)} ${dim(`[${c.spec.rule}]`)} ${c.severity === 'warn' ? yellow('warn') : ''}`,
    )
    console.log(`  ${c.title}`)
    console.log(`  ${dim('born')} run ${c.provenance.runId} iter ${c.provenance.iteration} ${dim('·')} ${dim(c.provenance.createdAt.slice(0, 16).replace('T', ' '))}`)
    console.log(`  ${dim('because')} ${c.provenance.because.slice(0, 200)}`)
    console.log(`  ${dim('stats')} ran ${c.stats.runs}× ${dim('·')} ${c.stats.trips ? magenta(`caught ${c.stats.trips} regression(s)`) : dim('never tripped')}`)
    console.log()
  }
  const trips = checks.reduce((n, c) => n + c.stats.trips, 0)
  console.log(dim(`${trips} regression(s) caught by this ratchet so far.`))
  return 0
}

async function cmdCheck(): Promise<number> {
  const name = argv[1]
  const store = new Store(repoRoot(cwd))
  const check = name ? store.getCheck(name) : null
  if (!check) {
    console.error(red(`No such check: ${name ?? '(none given)'}`))
    return 1
  }
  if (has('json')) {
    console.log(JSON.stringify(check, null, 2))
    return 0
  }
  console.log(heading(`${check.name} ${statusDot(check.status)} ${check.status}`))
  console.log(`${bold(check.title)}\n${check.message}\n`)
  console.log(`${bold('Why it exists')}`)
  console.log(`  ${check.provenance.because}`)
  console.log(`  ${dim(`witnesses: ${check.provenance.witnesses.join(', ') || '—'}`)}`)
  console.log(`  ${dim(`authored by ${check.provenance.author} in run ${check.provenance.runId}, iteration ${check.provenance.iteration}`)}\n`)

  const e = check.evidence
  if (e) {
    console.log(`${bold('Admission evidence')} ${dim('— proved before it was allowed to block anything')}`)
    console.log(`  ${e.failedOnDefect ? green('✓') : red('✗')} fails on the defective tree ${dim(`(${e.defectViolations.length} violation(s))`)}`)
    console.log(`  ${e.passedOnFix ? green('✓') : red('✗')} passes on the repaired tree`)
    console.log(`  ${e.passedOnBaseline ? green('✓') : red('✗')} passes on the run baseline`)
    console.log(`  ${dim(e.reason)}\n`)
  }
  console.log(`${bold('Spec')}`)
  if (check.spec.rule === 'script') {
    console.log(`  ${dim('asserts:')} ${check.spec.asserts}`)
    console.log(check.spec.source.split('\n').map((l) => '  ' + dim('│') + ' ' + l).join('\n'))
  } else {
    console.log(JSON.stringify(check.spec, null, 2).split('\n').map((l) => '  ' + l).join('\n'))
  }
  return 0
}

async function cmdRuns(): Promise<number> {
  const store = new Store(repoRoot(cwd))
  const runs = store.listRuns()
  if (has('json')) {
    console.log(JSON.stringify(runs, null, 2))
    return 0
  }
  if (runs.length === 0) {
    console.log(dim('No runs recorded.'))
    return 0
  }
  console.log(heading(`runs · ${runs.length}`))
  for (const r of runs) {
    const born = r.iterations.reduce((n, i) => n + i.bornCheckIds.length, 0)
    console.log(`${statusDot(r.status)} ${bold(r.id)} ${dim(r.createdAt.slice(0, 16).replace('T', ' '))}`)
    console.log(`  ${r.task}`)
    console.log(
      `  ${dim(`${r.iterations.length} iteration(s) · inherited ${r.inheritedCheckIds.length} check(s) · earned ${born}`)}`,
    )
    if (r.summary) console.log(`  ${dim(r.summary)}`)
    console.log()
  }
  return 0
}

async function cmdDemo(): Promise<number> {
  const dir = resolve(flag('dir') ?? './ratchet-demo')
  if (existsSync(dir) && !has('force')) {
    console.error(red(`${dir} already exists. Remove it or pass --force.`))
    return 1
  }
  return runDemo(dir)
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(red(`\n${e?.stack ?? e}`))
    process.exit(1)
  })
