import { overview, ago } from '../lib/data.ts'
import { CheckCard, Pill } from './_components.tsx'

export const dynamic = 'force-dynamic'

export default function Home() {
  const { checks, runs, totals } = overview()
  const quarantined = checks.filter((c) => c.status === 'quarantined')
  const retired = checks.filter((c) => c.status === 'retired')
  const active = checks.filter((c) => c.status === 'active')

  if (checks.length === 0 && runs.length === 0) {
    return (
      <div className="empty">
        Nothing here yet. Run <code>ratchet demo</code>, then point the UI at the fixture with{' '}
        <code>RATCHET_ROOT=./ratchet-demo npm run web</code>.
      </div>
    )
  }

  return (
    <>
      <div className="stats">
        <div className="stat hero">
          <div className="n">{totals.active}</div>
          <div className="k">checks earned</div>
        </div>
        <div className="stat hero">
          <div className="n">{totals.trips}</div>
          <div className="k">regressions caught</div>
        </div>
        <div className="stat">
          <div className="n">{totals.generated}</div>
          <div className="k">written as code</div>
        </div>
        <div className="stat">
          <div className="n">{totals.builtin}</div>
          <div className="k">built-in rules</div>
        </div>
        <div className="stat">
          <div className="n">{totals.quarantined}</div>
          <div className="k">failed admission</div>
        </div>
        <div className="stat">
          <div className="n">{totals.runs}</div>
          <div className="k">runs</div>
        </div>
      </div>

      <section>
        <h2>The ratchet</h2>
        <p className="section-note">
          None of these were written in advance. Each one exists because a real defect got past the harness once, and the
          Critic converted it into something a program can decide. They run, in order of cost, before any review happens.
        </p>
        {active.length === 0 ? (
          <div className="empty">No active checks yet.</div>
        ) : (
          active.map((c) => <CheckCard key={c.id} check={c} />)
        )}
      </section>

      {quarantined.length > 0 && (
        <section>
          <h2>Failed admission</h2>
          <p className="section-note">
            Proposed by the Critic, but could not prove itself: it either missed the defect it was written for, flagged
            the repair, or condemned code that was already in the repo. Kept for the record, never executed.
          </p>
          {quarantined.map((c) => (
            <CheckCard key={c.id} check={c} />
          ))}
        </section>
      )}

      {retired.length > 0 && (
        <section>
          <h2>Retired</h2>
          <p className="section-note">Errored three gauntlets running. An unreliable check is worse than none.</p>
          {retired.map((c) => (
            <CheckCard key={c.id} check={c} />
          ))}
        </section>
      )}

      <section>
        <h2>Recent runs</h2>
        <p className="section-note">Five stages per iteration. The gauntlet gates every one of them.</p>
        {runs.slice(0, 8).map((r) => {
          const born = r.iterations.reduce((n, i) => n + i.bornCheckIds.length, 0)
          return (
            <a className="check" href={`/runs/${r.id}`} key={r.id}>
              <div className="check-head">
                <span className="check-name">{r.id}</span>
                <Pill kind={r.status === 'passed' ? 'active' : r.status === 'running' ? '' : 'quarantined'}>
                  {r.status}
                </Pill>
                {born > 0 && <Pill kind="trips">+{born} check{born === 1 ? '' : 's'}</Pill>}
              </div>
              <div className="check-title">{r.task}</div>
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
    </>
  )
}
