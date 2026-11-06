import { Tag } from 'antd';
import type { Run } from '../server/contracts';
import { lifecycleLabels } from './lifecyclePresentation';
import RecoveryHistory from './RecoveryHistory';

export default function LifecycleProgress({ run }: { run: Run }) {
  const lifecycle = run.lifecycle;
  if (!lifecycle) return null;
  const { policy, phase, candidate, publication } = lifecycle;
  const stages = ['implementing', 'verifying', 'reviewing', 'publishing', 'complete'] as const;
  return <section className="detail-section lifecycle-progress" aria-label="Autonomous completion lifecycle">
    <div className="section-heading"><h3>Autonomous completion</h3><Tag className={phase === 'assistance' ? 'attention' : ''}>{lifecycleLabels[phase]}</Tag></div>
    <ol className="lifecycle-stages" aria-label="Completion stages">{stages.map(stage => <li key={stage} aria-current={phase === stage || stage === 'implementing' && (phase === 'correcting' || phase === 'recovering') ? 'step' : undefined}>{lifecycleLabels[stage]}</li>)}</ol>
    <p className="muted">Policy revision {policy.revision} · corrections {lifecycle.corrections}/{policy.maxCorrections} · recoveries {lifecycle.recoveries}/{policy.maxRecoveries}. All roles share this attempt's deadline and token limit. No push, PR, merge or deployment.</p>
    {phase === 'assistance' && <div className="error-banner" role="alert"><strong>Operator assistance required</strong><p>{lifecycle.exception || 'The autonomous attempt could not safely establish completion. Inspect the recorded evidence, candidate and workspace before deciding how to recover.'}</p><p>Automatic completion stopped; this is not Done. Preserve partial work. Use the ticket's existing reviewed recovery controls and, when gated, explicit workspace reconciliation. No blind retry or rollback is implied.</p></div>}
    {phase !== 'assistance' && lifecycle.exception && <p className="warning-text">{lifecycle.exception}</p>}
    <RecoveryHistory run={run} />
    <details className="run-record"><summary>Candidate &amp; authority identity{candidate ? ` · tree ${candidate.tree.slice(0, 12)}` : ' · candidate not captured yet'}</summary><dl className="run-metadata">
      <div><dt>Baseline commit</dt><dd>{lifecycle.baseline.head}</dd></div><div><dt>Branch ref</dt><dd>{lifecycle.baseline.ref}</dd></div><div><dt>Candidate tree</dt><dd>{candidate?.tree ?? 'Not captured yet'}</dd></div><div><dt>Candidate fingerprint</dt><dd>{candidate?.fingerprint ?? 'Not captured yet'}</dd></div><div><dt>Commissioned recipe hash</dt><dd>{lifecycle.recipeHash}</dd></div><div><dt>Author session</dt><dd>{lifecycle.authorSessionId ?? 'Not recorded'}</dd></div><div><dt>Author tokens</dt><dd>{lifecycle.authorTokens.toLocaleString()}</dd></div>
      <div><dt>Reviewer tokens</dt><dd>{lifecycle.reviewerTokens?.toLocaleString() ?? 'Not recorded'}</dd></div>
    </dl>{candidate && <><h4>Exact authored candidate paths</h4><pre tabIndex={0}>{candidate.files.length ? candidate.files.join('\n') : 'No authored path changes.'}</pre></>}<p className="muted">Host verification, independent review and publication must refer to this exact candidate tree and commissioned recipe. A later edit invalidates prior evidence.</p></details>
    <h4>Host-executed verification · {lifecycle.verification.length}</h4>
    <p className="muted">Host command execution receipts, separate from author-reported checks. A passing exit code is command evidence, not an independent guarantee that every acceptance criterion is satisfied.</p>
    {lifecycle.verification.length ? <div className="run-records">{lifecycle.verification.map(receipt => <details className="run-record" key={receipt.id}>
      <summary><Tag className={`run-outcome run-outcome-${receipt.outcome}`}>{receipt.outcome}</Tag> Host command · {new Date(receipt.started).toLocaleString()}</summary>
      <div className="run-record-body">
        <p>Provenance: <code>{receipt.source}</code> · exit {receipt.exitCode ?? 'unavailable'}</p>
        <p className="path">Candidate tree: {receipt.candidateTree}<br />Recipe hash: {receipt.recipeHash}</p>
        <pre tabIndex={0} aria-label="Executed command argv">{JSON.stringify(receipt.argv, null, 2)}</pre>
        <p>{new Date(receipt.started).toLocaleString()} → {new Date(receipt.finished).toLocaleString()}</p>
        {receipt.environment && <p>Host: {receipt.environment.platform} / {receipt.environment.arch} · {receipt.environment.runtime}</p>}
        <p className="path">Sanitized stored-output hash: {receipt.outputHash ?? 'Not recorded'}</p>
        <p>{receipt.outputTruncated === undefined ? 'Output truncation metadata unavailable.' : receipt.outputTruncated ? 'Output truncated to the host receipt limit.' : 'Output not truncated.'}</p>
        <pre tabIndex={0} aria-label="Sanitized host command output">{receipt.output || 'No output recorded.'}</pre>
      </div>
    </details>)}</div> : <p className="muted">No host command receipt recorded yet.</p>}
    <h4>Independent candidate review · {lifecycle.reviews.length}</h4>
    <p className="muted">Separate restricted OMP reviewer, not the author. Findings are reviewer conclusions based on source, diff and evidence; they are not host command execution.</p>
    {lifecycle.reviews.length ? <div className="run-records">{lifecycle.reviews.map((review, index) => <details className="run-record" key={`${review.sessionId}-${index}`}><summary><Tag className={`run-outcome run-outcome-${review.verdict === 'pass' ? 'passed' : review.verdict === 'changes_required' ? 'failed' : 'blocked'}`}>{review.verdict.replaceAll('_', ' ')}</Tag> {review.model}</summary><div className="run-record-body"><p className="path">Reviewer session: {review.sessionId}<br />Candidate tree: {review.candidateTree}<br />Recorded: {new Date(review.recorded).toLocaleString()}</p><h4>Findings</h4>{review.findings.length ? <ul>{review.findings.map((finding, i) => <li key={i}>{finding}</li>)}</ul> : <p>No findings recorded.</p>}<h4>Criterion evidence inspected</h4>{review.criteria.length ? <dl>{review.criteria.map((criterion, i) => <div key={i}><dt>{criterion.criterion}</dt><dd>{criterion.evidence}</dd></div>)}</dl> : <p>No criterion evidence recorded.</p>}</div></details>)}</div> : <p className="muted">No independent review recorded yet.</p>}
    <h4>Local publication</h4>
    {publication ? <><p>{publication.state === 'complete' ? publication.noChanges ? 'No-change completion · no empty commit created.' : 'Local commit completed.' : publication.state === 'published' ? 'Local ref updated · finalization pending; not yet complete.' : 'Publication intent recorded · local ref update not yet confirmed.'}</p><dl className="run-metadata"><div><dt>Publication state</dt><dd>{publication.state}</dd></div><div><dt>Commit</dt><dd>{publication.commit ?? (publication.noChanges ? 'None · no changes' : 'Not recorded')}</dd></div><div><dt>Reviewed tree</dt><dd>{publication.tree}</dd></div><div><dt>Parent</dt><dd>{publication.parent}</dd></div><div><dt>Ref</dt><dd>{publication.ref}</dd></div></dl></> : <p className="muted">No local publication recorded. Verification or review alone does not mean committed or Done.</p>}
  </section>;
}
