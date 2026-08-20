import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ScriptedModel, Store, runLoop, type AgentTask, type ScriptedStep } from '@ratchet/core'
import { bold, cyan, dim, green, heading, magenta, red, statusDot } from './format.ts'

/**
 * A fully scripted end-to-end demonstration — no API key required.
 *
 * Run 1: the Builder duplicates `formatMoney` and hardcodes a currency symbol.
 *        No check exists yet, so the gauntlet waves it through. The Critic catches
 *        both, the Builder repairs them, and the Critic authors two checks that are
 *        then *proved* against the defective and repaired trees before admission.
 *
 * Run 2: a fresh task, and the Builder makes the same class of mistake again.
 *        This time nothing reaches the Critic — the gauntlet stops it in milliseconds.
 *
 * That gap between run 1 and run 2 is the whole product.
 */

// ---------------------------------------------------------------------------
// Fixture repository
// ---------------------------------------------------------------------------

const MONEY = `export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
}

export function formatMoney(cents: number, currency = 'USD'): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? ''
  return symbol + (cents / 100).toFixed(2)
}
`

const CART = `import { formatMoney } from './money.ts'

export interface CartLine {
  label: string
  cents: number
}

export function renderCart(lines: CartLine[], currency = 'USD'): string {
  return lines.map((l) => l.label + '  ' + formatMoney(l.cents, currency)).join('\\n')
}
`

/** What the Builder writes on its first attempt: a redeclared helper and a hardcoded symbol. */
const INVOICE_BAD = `export interface InvoiceLine {
  label: string
  cents: number
}

function formatMoney(cents: number): string {
  return '$' + (cents / 100).toFixed(2)
}

export function renderInvoice(lines: InvoiceLine[]): string {
  const total = lines.reduce((n, l) => n + l.cents, 0)
  const body = lines.map((l) => l.label + '  ' + formatMoney(l.cents)).join('\\n')
  return body + '\\nTotal  ' + formatMoney(total) + '\\nAmounts shown in $'
}
`

/** After the duplicate declaration is repaired. The hardcoded symbol survives. */
const INVOICE_DEDUPED = `import { formatMoney } from './money.ts'

export interface InvoiceLine {
  label: string
  cents: number
}

export function renderInvoice(lines: InvoiceLine[], currency = 'USD'): string {
  const total = lines.reduce((n, l) => n + l.cents, 0)
  const body = lines.map((l) => l.label + '  ' + formatMoney(l.cents, currency)).join('\\n')
  return body + '\\nTotal  ' + formatMoney(total, currency) + '\\nAmounts shown in $'
}
`

/** After both repairs. */
const INVOICE_GOOD = `import { CURRENCY_SYMBOLS, formatMoney } from './money.ts'

export interface InvoiceLine {
  label: string
  cents: number
}

export function renderInvoice(lines: InvoiceLine[], currency = 'USD'): string {
  const total = lines.reduce((n, l) => n + l.cents, 0)
  const body = lines.map((l) => l.label + '  ' + formatMoney(l.cents, currency)).join('\\n')
  const note = 'Amounts shown in ' + (CURRENCY_SYMBOLS[currency] ?? currency)
  return body + '\\nTotal  ' + formatMoney(total, currency) + '\\n' + note
}
`

/** Run 2, first attempt: the same class of mistake, in a new file. */
const RECEIPT_BAD = `export interface ReceiptLine {
  label: string
  cents: number
}

function formatMoney(cents: number): string {
  return '$' + (cents / 100).toFixed(2)
}

export function renderReceipt(lines: ReceiptLine[]): string {
  return lines.map((l) => l.label + '  ' + formatMoney(l.cents)).join('\\n')
}
`

const RECEIPT_GOOD = `import { formatMoney } from './money.ts'

export interface ReceiptLine {
  label: string
  cents: number
}

export function renderReceipt(lines: ReceiptLine[], currency = 'USD'): string {
  return lines.map((l) => l.label + '  ' + formatMoney(l.cents, currency)).join('\\n')
}
`

function scaffold(dir: string): void {
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'billing-demo', private: true, type: 'module' }, null, 2) + '\n')
  writeFileSync(join(dir, 'README.md'), '# billing-demo\n\nFixture repository for the Ratchet demo.\n')
  writeFileSync(join(dir, 'src/money.ts'), MONEY)
  writeFileSync(join(dir, 'src/cart.ts'), CART)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  git('init', '-q')
  git('config', 'user.email', 'demo@ratchet.local')
  git('config', 'user.name', 'Ratchet Demo')
  git('add', '-A')
  git('commit', '-q', '-m', 'initial billing helpers')
}

// ---------------------------------------------------------------------------
// The generated check the Critic "writes" for the hardcoded-symbol defect
// ---------------------------------------------------------------------------

const SYMBOL_CHECK_SOURCE = `export default async function check(ctx) {
  // Currency presentation is owned by src/money.ts. Anywhere else, a literal
  // currency glyph means someone reimplemented formatting by hand.
  const CANONICAL = 'src/money.ts'
  const GLYPHS = ['$', '\\u20ac', '\\u00a3', '\\u00a5']
  const STRING_LITERAL = /(['"\`])((?:[^'"\`\\\\]|\\\\.)*)\\1/g

  for (const file of ctx.files) {
    if (file.path === CANONICAL) continue
    if (!/\\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file.path)) continue
    for (const match of file.text.matchAll(STRING_LITERAL)) {
      const glyph = GLYPHS.find((g) => match[2].includes(g))
      if (!glyph) continue
      ctx.violate(
        file.path,
        'Currency glyph "' + glyph + '" is hardcoded in a string literal. Read it from CURRENCY_SYMBOLS in ' + CANONICAL + ' instead.',
        { line: ctx.lineOf(file.text, match.index), excerpt: match[0].slice(0, 80) },
      )
    }
  }
  return { ok: true }
}
`

// ---------------------------------------------------------------------------
// Scripted model turns
// ---------------------------------------------------------------------------

function write(dir: string, rel: string, content: string): void {
  writeFileSync(join(dir, rel), content)
}

function run1Steps(dir: string): ScriptedStep[] {
  return [
    () => `src/money.ts exports formatMoney(cents, currency) and CURRENCY_SYMBOLS.
src/cart.ts shows the rendering convention: label, two spaces, formatted amount.
An invoice renderer belongs in src/invoice.ts and should follow the same shape.`,

    () => `1. Add src/invoice.ts with an InvoiceLine interface and renderInvoice().
2. Reuse the cart rendering shape.
3. Append a total line.`,

    () => {
      write(dir, 'src/invoice.ts', INVOICE_BAD)
      return `Added src/invoice.ts with InvoiceLine and renderInvoice(), plus a small money
formatter and a footer noting the currency.`
    },

    // Critic review — two findings, both mechanically detectable.
    () =>
      JSON.stringify({
        summary: 'renderInvoice works, but it reimplements money formatting instead of using the existing helper.',
        findings: [
          {
            title: 'formatMoney redeclared in src/invoice.ts',
            detail:
              'src/money.ts already exports formatMoney(cents, currency). src/invoice.ts declares a second, ' +
              'currency-blind formatMoney. Two implementations of the same concept will drift, and the new one ' +
              'silently ignores the currency argument callers will expect.',
            severity: 'error',
            files: ['src/invoice.ts', 'src/money.ts'],
            deterministic: true,
            checkIdea: 'Assert that formatMoney is declared only in src/money.ts.',
          },
          {
            title: 'Currency glyph hardcoded outside src/money.ts',
            detail:
              'src/invoice.ts embeds a literal "$" in its footer string. Currency presentation is owned by ' +
              'CURRENCY_SYMBOLS in src/money.ts; hardcoding the glyph makes the invoice wrong for every ' +
              'non-USD currency.',
            severity: 'error',
            files: ['src/invoice.ts'],
            deterministic: true,
            checkIdea: 'Forbid literal currency glyphs in string literals in any file other than src/money.ts.',
          },
        ],
      }),

    // Repair 1
    () => {
      write(dir, 'src/invoice.ts', INVOICE_DEDUPED)
      return 'Deleted the local formatMoney and imported the one from src/money.ts, threading currency through.'
    },

    // Author check 1
    () =>
      JSON.stringify({
        name: 'format-money-declared-once',
        title: 'formatMoney is declared only in src/money.ts',
        message:
          'You declared formatMoney outside src/money.ts. Import it from src/money.ts instead of writing a second ' +
          'implementation — the existing one handles currency.',
        severity: 'error',
        spec: {
          rule: 'canonical-symbol',
          symbol: 'formatMoney',
          declaredIn: 'src/money.ts',
          hint: 'Import formatMoney from src/money.ts.',
        },
      }),

    // Repair 2
    () => {
      write(dir, 'src/invoice.ts', INVOICE_GOOD)
      return 'Replaced the hardcoded "$" with a CURRENCY_SYMBOLS lookup keyed on the currency argument.'
    },

    // Author check 2 — no built-in rule expresses this, so the Critic writes code.
    () =>
      JSON.stringify({
        name: 'no-hardcoded-currency-glyph',
        title: 'Currency glyphs appear only in src/money.ts',
        message:
          'A literal currency glyph appeared in a string outside src/money.ts. Look the symbol up in ' +
          'CURRENCY_SYMBOLS so the output is correct for every currency.',
        severity: 'error',
        spec: {
          rule: 'script',
          asserts: 'No file other than src/money.ts contains a currency glyph inside a string literal.',
          source: SYMBOL_CHECK_SOURCE,
        },
      }),

    // Iteration 1 review — clean.
    () => JSON.stringify({ summary: 'Both defects are repaired and the change is confined to src/invoice.ts.', findings: [] }),
  ]
}

function run2Steps(dir: string): ScriptedStep[] {
  return [
    () => `src/money.ts owns formatMoney and CURRENCY_SYMBOLS. src/cart.ts and src/invoice.ts
both render line items the same way. A receipt renderer belongs in src/receipt.ts.`,

    () => `1. Add src/receipt.ts with ReceiptLine and renderReceipt().
2. Match the existing line rendering.`,

    () => {
      write(dir, 'src/receipt.ts', RECEIPT_BAD)
      return 'Added src/receipt.ts with a ReceiptLine interface, renderReceipt(), and a money formatter.'
    },

    // The gauntlet trips before any Critic sees this.
    (task: AgentTask) => {
      write(dir, 'src/receipt.ts', RECEIPT_GOOD)
      return 'Removed the duplicate formatMoney and the hardcoded glyph; renderReceipt now imports from src/money.ts.'
    },

    () => JSON.stringify({ summary: 'renderReceipt reuses the shared formatter and follows the existing rendering shape.', findings: [] }),
  ]
}

function firstSentence(text: string): string {
  const m = text.match(/^.*?[.!?](?=\s|$)/s)
  return (m ? m[0] : text).trim().slice(0, 180)
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export async function runDemo(dir: string): Promise<number> {
  console.log(heading('ratchet demo'))
  console.log(`${dim('fixture')} ${dir}\n`)
  scaffold(dir)

  console.log(bold('Run 1 ') + dim('— "add an invoice renderer". The repo has no checks yet.'))
  const first = await runLoop({
    task: 'Add an invoice renderer that prints line items and a total.',
    cwd: dir,
    model: new ScriptedModel(run1Steps(dir), 'scripted/demo'),
    onEvent: (line) => console.log(dim(line)),
  })
  console.log(`${statusDot(first.run.status)} ${first.run.status} — ${first.run.summary}\n`)

  const store = new Store(dir)
  const earned = store.activeChecks()
  console.log(bold('Checks earned in run 1'))
  for (const c of earned) {
    console.log(`  ${green('+')} ${bold(c.name)} ${dim(`[${c.spec.rule}]`)}`)
    console.log(`      ${dim(firstSentence(c.provenance.because))}`)
    const e = c.evidence!
    console.log(
      `      ${dim('proved:')} ${e.failedOnDefect ? green('caught the defect') : red('did not catch the defect')}${dim(' · ')}` +
        `${e.passedOnFix ? green('clean on the fix') : red('false-positived on the fix')}${dim(' · ')}` +
        `${e.passedOnBaseline ? green('clean on baseline') : red('broke the baseline')}`,
    )
  }
  const rejected = store.listChecks().filter((c) => c.status !== 'active')
  for (const c of rejected) console.log(`  ${red('-')} ${c.name} ${dim('rejected: ' + c.evidence?.reason)}`)

  console.log(`\n${bold('Run 2 ')}${dim('— "add a receipt renderer". Same class of mistake, but the ratchet is loaded now.')}`)
  const second = await runLoop({
    task: 'Add a receipt renderer that prints line items.',
    cwd: dir,
    model: new ScriptedModel(run2Steps(dir), 'scripted/demo'),
    onEvent: (line) => console.log(dim(line)),
  })
  console.log(`${statusDot(second.run.status)} ${second.run.status} — ${second.run.summary}\n`)

  const after = new Store(dir).listChecks()
  const trips = after.reduce((n, c) => n + c.stats.trips, 0)
  console.log(heading('what happened'))
  console.log(`  Run 1 shipped two defects to the Critic. Both became permanent checks.`)
  console.log(`  Run 2 made the ${magenta('same')} mistakes and never reached the Critic — the gauntlet caught them in`)
  console.log(`  ${dim(`${after.reduce((n, c) => n + c.stats.avgDurationMs, 0)}ms`)} of deterministic analysis. ${magenta(`${trips} regression(s)`)} caught in total.\n`)
  console.log(`  ${cyan(`ratchet checks --cwd ${dir}`)}          the earned checks`)
  console.log(`  ${cyan(`ratchet check no-hardcoded-currency-glyph --cwd ${dir}`)}   the code the Critic wrote`)
  console.log(`  ${cyan(`RATCHET_ROOT=${dir} npm run web`)}     the UI\n`)

  return first.run.status === 'passed' && second.run.status === 'passed' ? 0 : 1
}
