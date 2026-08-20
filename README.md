# ratchet

**One agent does the work. A different agent scrutinises it. Every defect that a program could have caught becomes a deterministic check — written during the task, proved against the code that contained the bug, and run on every change from then on.**

The checks are not predefined. There is no rule pack to configure. The registry starts empty and grows only in response to defects that actually happened, which is what makes long autonomous runs survivable: the failure modes you hit once stop being failure modes.

```
ratchet demo          # full end-to-end run, no API key needed
```

---

## The problem

An agent adds `formatMoney` to `invoice.ts`. The repo already exports `formatMoney` from `money.ts`. A reviewer catches it, the agent fixes it, everyone moves on — and three tasks later the agent does it again, because nothing about the codebase changed to make it impossible.

Review that only produces prose is a treadmill. Ratchet's rule: **a defect is not resolved until it is unrepeatable.**

## The loop

Five stages per iteration, following the agent-native shape Factory describes (gather context → plan → implement → validate → submit). All the interesting machinery is in `validate`, which holds two gates:

```
 1 gather context ─┐
 2 plan            ├── Builder (edit tools)
 3 implement      ─┘
 4 validate ── gate 1: THE GAUNTLET      every earned check, deterministic, no model involved
           └─ gate 2: THE CRITIC         a separate agent that never wrote this code
 5 submit
```

- **Gate 1 fails** → the failure goes straight back to the Builder with the check's own message. No model was asked for an opinion, so this costs milliseconds and cannot be argued with.
- **Gate 2 finds something** → the Builder repairs it, and then the Critic must **author the deterministic check that would have caught it**. Gate 1 is strictly stronger on the next iteration and in every future run.
- **Gate 2 finds nothing** → submit.

Findings the Critic marks as judgement-bound (naming, taste, product calls) are reported but never ratcheted. Only mechanically decidable defects become checks.

## Admission control

This is the part that decides whether the idea works or just sounds good. A model that is asked "write a lint rule for this bug" will happily produce a rule that doesn't fire, or one that condemns half the repo. So a proposed check is not trusted — it is **tested**, against three frozen snapshots of the tree:

| Gate | Requirement | What it prevents |
|---|---|---|
| 1 | **Fails** on the defective tree | A decorative check that wouldn't have caught the bug it was written for |
| 2 | **Passes** on the repaired tree | A false-positive generator that wedges every later iteration |
| 3 | **Passes** on the run's baseline | A rule that retroactively condemns pre-existing code and blocks unrelated work |

Miss any one and the check is written to disk as `quarantined` — visible in the UI, never executed. Quarantined checks are as informative as admitted ones: they show where the Critic reached for a rule it could not justify.

A check that *errors* (rather than fires) on three consecutive gauntlets is auto-`retired`. An unreliable check is worse than no check.

## What a check is

Two tiers, both authored at task time.

**Built-in rules** — parameterised, so there is no generated code to sandbox or review:

```json
{ "rule": "canonical-symbol", "symbol": "formatMoney", "declaredIn": "src/money.ts" }
```

Also: `no-duplicate-symbol` (ts-morph AST), `forbid-pattern`, `require-pattern`, `forbid-import`, `forbid-paths`, `command` (tsc, tests, anything with an exit code).

**Generated scripts** — when no built-in expresses the invariant, the Critic writes real code:

```js
export default async function check(ctx) {
  const CANONICAL = 'src/money.ts'
  const GLYPHS = ['$', '€', '£', '¥']
  for (const file of ctx.files) {
    if (file.path === CANONICAL) continue
    for (const match of file.text.matchAll(STRING_LITERAL)) {
      const glyph = GLYPHS.find((g) => match[2].includes(g))
      if (glyph) ctx.violate(file.path, `Currency glyph "${glyph}" is hardcoded.`, { line: ctx.lineOf(file.text, match.index) })
    }
  }
  return { ok: true }
}
```

Scripts run in a forked process against an inert, pre-computed snapshot (`ctx.files`, `ctx.declarations` from the AST, `ctx.glob`, `ctx.read`) with a 20-second budget and no filesystem, network or shell access. A bad generated check can waste time; it cannot touch the repo.

## Where state lives

```
.ratchet/
  checks/<name>.json     one file per check — diffable, reviewable in a PR, travels with the repo
  runs/<runId>.json      full transcript: stages, gauntlet attempts, findings, checks born
  events.jsonl           append-only event log
```

Because the registry is files in the repo, cloning the repo inherits everything it has earned, and tightening the ratchet shows up in code review like any other change.

## The UI

```bash
RATCHET_ROOT=/path/to/repo npm run web     # http://localhost:4327
```

- **The ratchet** — every check, with the defect that created it quoted verbatim, the admission evidence (which snapshot it fired on and which it cleared), the generated source, and how many regressions it has caught since.
- **Runs** — the five-stage timeline per iteration, with each gauntlet pass shown separately, so you can see exactly which regression was stopped before a Critic was ever invoked.
- **Failed admission** — proposals that could not prove themselves, and why.

## CLI

```bash
ratchet run "<task>"      # the five-stage loop against the current repo
ratchet gauntlet          # run every earned check against the working tree (use in CI)
ratchet checks [--all]    # what this repo has earned
ratchet check <name>      # provenance, admission evidence, source
ratchet runs
ratchet demo [--dir path] # scripted end-to-end run, no API key
```

Flags: `--cwd <path>`, `--commit`, `--max-iterations <n>`, `--json`.

`ratchet run` uses the Claude Agent SDK (`ANTHROPIC_API_KEY` or an existing Claude Code login; override the model with `RATCHET_MODEL`). Everything else is deterministic and works offline.

## The demo

`ratchet demo` builds a small billing repo and runs two tasks against it.

**Run 1** — *add an invoice renderer*. The registry is empty, so the gauntlet waves the change through. The Builder has redeclared `formatMoney` and hardcoded a `$`. The Critic catches both, the Builder repairs them, and two checks are authored and admitted — one built-in, one generated.

**Run 2** — *add a receipt renderer*. The Builder makes the same two mistakes in a new file. Neither reaches the Critic. The gauntlet stops them in a few hundred milliseconds of AST and string analysis, hands the Builder the checks' own messages, and the repair lands on the first retry.

That gap between run 1 and run 2 is the entire product.

## Why this makes long runs viable

A gauntlet loop that runs unattended for hours fails for a boring reason: the same mistake, made repeatedly, with a reviewer that forgets between iterations. Prime Intellect's Prime Agent addresses the sibling problem by letting an agent refine its own prompts, memories and skills into durable state. Ratchet takes the adversarial half of that idea and makes the durable state **executable and falsifiable** rather than advisory: a memory can be ignored by the next model, a check cannot.

The properties that follow:

- **Monotonic.** Coverage only tightens. The Nth run inherits everything the first N−1 earned.
- **Cheap.** Deterministic checks cost milliseconds. Every defect they absorb is one that no longer needs a model round-trip.
- **Auditable.** Every check names the defect that created it and shows the evidence it passed to get in.
- **Portable.** `ratchet gauntlet` is a CI command. The checks an agent earned protect human commits too.

## Layout

```
packages/core/     engine: loop, gauntlet, admission control, check runners, model adapters
apps/cli/          ratchet CLI + the scripted demo
apps/web/          Next.js dashboard over .ratchet/
```

Node 20+ (native TypeScript execution; no build step for core or CLI).
