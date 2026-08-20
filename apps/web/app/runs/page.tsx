import { overview, ago } from '../../lib/data.ts'
import { Pill } from '../_components.tsx'

export const dynamic = 'force-dynamic'

export default function Runs() {
  const { runs } = overview()
  if (runs.length === 0) return <div className="empty">No runs recorded yet.</div>
  return (
    <section>
      <h2>Runs</h2>
      <p className="section-note">
        Each run inherits every check the repository has earned so far, and may add more before it finishes.
      </p>
      {runs.map((r) => {
        const born = r.iterations.reduce((n, i) => n + i.bornCheckIds.length, 0)
        const caught = r.iterations.reduce((n, i) => n + (i.gauntletAttempts ?? []).reduce((m, a) => m + a.failures.length, 0), 0)
        return (
          <a className="check" href={`/runs/${r.id}`} key={r.id}>
            <div className="check-head">
              <span className="check-name">{r.id}</span>
              <Pill kind={r.status === 'passed' ? 'active' : r.status === 'running' ? '' : 'quarantined'}>{r.status}</Pill>
              {born > 0 && <Pill kind="trips">+{born} check{born === 1 ? '' : 's'}</Pill>}
              {caught > 0 && <Pill kind="quarantined">gauntlet stopped {caught}</Pill>}
            </div>
            <div className="check-title">{r.task}</div>
            {r.summary && <div className="because"><b>outcome</b>{r.summary}</div>}
            <div className="check-foot">
              <span>{r.iterations.length} iteration{r.iterations.length === 1 ? '' : 's'}</span>
              <span>inherited {r.inheritedCheckIds.length}</span>
              <span>{r.model}</span>
              <span>{ago(r.createdAt)}</span>
            </div>
          </a>
        )
      })}
    </section>
  )
}
