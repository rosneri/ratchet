import type { Check, Iteration, Run } from '@ratchet/core/types'
import { ago, duration } from '../lib/data.ts'

export function Pill({ kind, children }: { kind: string; children: React.ReactNode }) {
  return <span className={`pill ${kind}`}>{children}</span>
}

export function CheckCard({ check }: { check: Check }) {
  const generated = check.spec.rule === 'script'
  return (
    <a className="check" href={`/checks/${check.name}`}>
      <div className="check-head">
        <span className="check-name">{check.name}</span>
        <Pill kind={check.status}>{check.status}</Pill>
        <Pill kind={generated ? 'script' : ''}>{generated ? 'generated code' : check.spec.rule}</Pill>
        {check.severity === 'warn' && <Pill kind="warn">warn</Pill>}
        {check.stats.trips > 0 && (
          <Pill kind="trips">
            caught {check.stats.trips} regression{check.stats.trips === 1 ? '' : 's'}
          </Pill>
        )}
      </div>
      <div className="check-title">{check.title}</div>
      <div className="because">
        <b>born because</b>
        {check.provenance.because}
      </div>
      <div className="check-foot">
        <span>
          run {check.provenance.runId} · iteration {check.provenance.iteration}
        </span>
        <span>{ago(check.provenance.createdAt)}</span>
        <span>ran {check.stats.runs}×</span>
        <span>~{check.stats.avgDurationMs}ms</span>
      </div>
    </a>
  )
}

const STAGES = ['context', 'plan', 'implement', 'validate', 'submit'] as const
const STAGE_LABEL: Record<string, string> = {
  context: 'Gather context',
  plan: 'Plan',
  implement: 'Implement',
  validate: 'Validate',
  submit: 'Submit',
}

export function IterationCard({ run, iteration }: { run: Run; iteration: Iteration }) {
  return (
    <div className="iteration">
      <div className="iteration-head">
        <span>iteration {iteration.index}</span>
        <Pill kind={iteration.outcome === 'clean' ? 'active' : iteration.outcome === 'blocked' ? 'quarantined' : ''}>
          {iteration.outcome}
        </Pill>
        <span className="faint">{duration(iteration.startedAt, iteration.endedAt)}</span>
        {iteration.gauntlet && (
          <span className="faint">
            gauntlet: {iteration.gauntlet.ran} check{iteration.gauntlet.ran === 1 ? '' : 's'},{' '}
            {iteration.gauntlet.passed ? 'green' : `${iteration.gauntlet.failures.length} failing`} ·{' '}
            {iteration.gauntlet.durationMs}ms
          </span>
        )}
      </div>

      <div className="stages">
        {STAGES.map((name, i) => {
          const rec = iteration.stages[name]
          const skipped = !rec || /carried over|outstanding/.test(rec.summary)
          return (
            <div key={name} className={`stage ${name === 'validate' ? 'gate-stage' : ''} ${skipped ? 'skipped' : ''}`}>
              <div className="idx">{i + 1}</div>
              <div className="nm">{STAGE_LABEL[name]}</div>
              <div className="sm">{rec ? rec.summary : 'not reached'}</div>
            </div>
          )
        })}
      </div>

      {(iteration.gauntletAttempts ?? [])
        .flatMap((attempt, pass) => attempt.failures.map((f) => ({ ...f, pass })))
        .map(({ check, result, pass }) => (
        <div className="finding" key={`${pass}-${check.id}`}>
          <div className="t">
            <Pill kind="quarantined">gauntlet · pass {pass + 1}</Pill>
            <a href={`/checks/${check.name}`}>{check.name}</a>
            <span className="faint">caught this and sent it back before any Critic saw it</span>
          </div>
          <table className="violations">
            <tbody>
              {result.violations.slice(0, 8).map((v, i) => (
                <tr key={i}>
                  <td className="f">
                    {v.file}
                    {v.line ? `:${v.line}` : ''}
                  </td>
                  <td className="dim">{v.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {iteration.findings.map((f) => (
        <div className="finding" key={f.id}>
          <div className="t">
            <Pill kind={f.deterministic ? 'trips' : ''}>{f.deterministic ? 'ratcheted' : 'judgement'}</Pill>
            {f.title}
          </div>
          <div className="d">{f.detail}</div>
          {f.checkIdea && (
            <div className="d faint" style={{ marginTop: 6 }}>
              check idea: {f.checkIdea}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
