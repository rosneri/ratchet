import { notFound } from 'next/navigation'
import { store, duration } from '../../../lib/data.ts'
import { IterationCard, Pill } from '../../_components.tsx'

export const dynamic = 'force-dynamic'

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const s = store()
  const run = s.getRun(decodeURIComponent(id))
  if (!run) notFound()

  const born = run.iterations.flatMap((i) => i.bornCheckIds).map((cid) => s.getCheck(cid)).filter(Boolean)

  return (
    <>
      <a className="back" href="/runs">← all runs</a>
      <h1>{run.id}</h1>
      <div className="row" style={{ marginBottom: 14 }}>
        <Pill kind={run.status === 'passed' ? 'active' : run.status === 'running' ? '' : 'quarantined'}>{run.status}</Pill>
        <Pill kind="">{run.model}</Pill>
        <Pill kind="">inherited {run.inheritedCheckIds.length} check{run.inheritedCheckIds.length === 1 ? '' : 's'}</Pill>
        <Pill kind="">{duration(run.createdAt, run.endedAt)}</Pill>
      </div>
      <p className="lede">{run.task}</p>
      {run.summary && <p className="section-note">{run.summary}</p>}

      <section>
        <h2>Iterations</h2>
        <p className="section-note">
          Validate is the only stage that can stop a run. It holds two gates: the deterministic gauntlet, then a Critic
          that never wrote this code.
        </p>
        {run.iterations.map((it) => (
          <IterationCard key={it.index} run={run} iteration={it} />
        ))}
      </section>

      {born.length > 0 && (
        <section>
          <h2>Checks born in this run</h2>
          <p className="section-note">Every future change to this repository now has to get past these.</p>
          {born.map((c) => (
            <a className="check" href={`/checks/${c!.name}`} key={c!.id}>
              <div className="check-head">
                <span className="check-name">{c!.name}</span>
                <Pill kind={c!.status}>{c!.status}</Pill>
                <Pill kind={c!.spec.rule === 'script' ? 'script' : ''}>
                  {c!.spec.rule === 'script' ? 'generated code' : c!.spec.rule}
                </Pill>
              </div>
              <div className="check-title">{c!.title}</div>
              {c!.evidence && <div className="because"><b>admission</b>{c!.evidence.reason}</div>}
            </a>
          ))}
        </section>
      )}
    </>
  )
}
