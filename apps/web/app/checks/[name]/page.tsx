import { notFound } from 'next/navigation'
import { store } from '../../../lib/data.ts'
import { Pill } from '../../_components.tsx'
import type { Violation } from '@ratchet/core/types'

export const dynamic = 'force-dynamic'

function Violations({ list, empty }: { list: Violation[]; empty: string }) {
  if (list.length === 0) return <div className="faint" style={{ fontSize: 12.5 }}>{empty}</div>
  return (
    <table className="violations">
      <tbody>
        {list.slice(0, 12).map((v, i) => (
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
  )
}

export default async function CheckPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  const check = store().getCheck(decodeURIComponent(name))
  if (!check) notFound()

  const e = check.evidence
  const generated = check.spec.rule === 'script'

  return (
    <>
      <a className="back" href="/">
        ← all checks
      </a>
      <h1>{check.name}</h1>
      <div className="row" style={{ marginBottom: 14 }}>
        <Pill kind={check.status}>{check.status}</Pill>
        <Pill kind={generated ? 'script' : ''}>{generated ? 'generated code' : check.spec.rule}</Pill>
        <Pill kind={check.severity === 'warn' ? 'warn' : ''}>{check.severity}</Pill>
        {check.stats.trips > 0 && <Pill kind="trips">caught {check.stats.trips}</Pill>}
      </div>
      <p className="lede">{check.title}</p>

      <section>
        <h2>What the Builder is told when it trips</h2>
        <pre className="code">{check.message}</pre>
      </section>

      <section>
        <h2>Why it exists</h2>
        <p className="section-note" style={{ color: 'var(--text-dim)' }}>
          {check.provenance.because}
        </p>
        <div className="check-foot" style={{ marginTop: 0 }}>
          <span>authored by {check.provenance.author}</span>
          <span>
            run {check.provenance.runId} · iteration {check.provenance.iteration}
          </span>
          <span>{new Date(check.provenance.createdAt).toLocaleString()}</span>
          {check.provenance.witnesses.length > 0 && <span>witnesses: {check.provenance.witnesses.join(', ')}</span>}
        </div>
      </section>

      {e && (
        <section>
          <h2>Admission evidence</h2>
          <p className="section-note">
            A check is not trusted because a model proposed it. Before it was allowed to block anything, it was run
            against three frozen snapshots of the tree.
          </p>
          <div className="evidence">
            <div className="gate">
              <div className={`mark ${e.failedOnDefect ? 'pass' : 'fail'}`}>{e.failedOnDefect ? '✓' : '✗'}</div>
              <div className="body">
                <div className="g">Fails on the defective tree</div>
                <div className="w">Proves the check would have caught the bug that motivated it.</div>
                <div style={{ marginTop: 8 }}>
                  <Violations list={e.defectViolations} empty="No violations — the check did not detect the defect." />
                </div>
              </div>
            </div>
            <div className="gate">
              <div className={`mark ${e.passedOnFix ? 'pass' : 'fail'}`}>{e.passedOnFix ? '✓' : '✗'}</div>
              <div className="body">
                <div className="g">Passes on the repaired tree</div>
                <div className="w">Proves it is not a false-positive generator that would wedge every later iteration.</div>
                {e.fixViolations.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <Violations list={e.fixViolations} empty="" />
                  </div>
                )}
              </div>
            </div>
            <div className="gate">
              <div className={`mark ${e.passedOnBaseline ? 'pass' : 'fail'}`}>{e.passedOnBaseline ? '✓' : '✗'}</div>
              <div className="body">
                <div className="g">Passes on the run baseline</div>
                <div className="w">
                  Proves it does not retroactively condemn code that was already there and block unrelated work.
                </div>
                {e.baselineViolations.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <Violations list={e.baselineViolations} empty="" />
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="check-foot">
            <span>{e.reason}</span>
            <span>{e.durationMs}ms to prove</span>
          </div>
        </section>
      )}

      <section>
        <h2>{generated ? 'The code the Critic wrote' : 'Rule'}</h2>
        {check.spec.rule === 'script' ? (
          <>
            <p className="section-note">
              No built-in rule expressed this invariant, so the Critic wrote one. It runs in a forked process with a
              read-only snapshot of the codebase — no filesystem, no network, no shell, 20s budget.
              <br />
              <span className="faint">asserts: {check.spec.asserts}</span>
            </p>
            <pre className="code">{check.spec.source}</pre>
          </>
        ) : (
          <pre className="code">{JSON.stringify(check.spec, null, 2)}</pre>
        )}
      </section>

      <section>
        <h2>Track record</h2>
        <div className="stats">
          <div className="stat">
            <div className="n">{check.stats.runs}</div>
            <div className="k">gauntlets run</div>
          </div>
          <div className="stat hero">
            <div className="n">{check.stats.trips}</div>
            <div className="k">regressions caught</div>
          </div>
          <div className="stat">
            <div className="n">{check.stats.avgDurationMs}ms</div>
            <div className="k">average cost</div>
          </div>
          <div className="stat">
            <div className="n">{check.stats.lastTrippedAt ? new Date(check.stats.lastTrippedAt).toLocaleDateString() : '—'}</div>
            <div className="k">last tripped</div>
          </div>
        </div>
      </section>
    </>
  )
}
