import { Tag } from 'antd';
import type { RecoveryHistory as Attempt, Run } from '../server/contracts';

const outcomes: Record<Attempt['state'], string> = {
  observed: 'Failure observed', authorized: 'Recovering', dispatched: 'Recovering', paused: 'Recovery paused',
  recovered: 'Recovered', still_blocked: 'Still blocked', needs_assistance: 'Needs assistance',
};

export default function RecoveryHistory({ run }: { run: Run }) {
  const history = run.lifecycle?.recoveryHistory ?? [];
  if (!history.length) return null;
  const total = (run.lifecycle?.authorTokens ?? 0) + (run.lifecycle?.reviewerTokens ?? 0);
  const repairs = history.filter(entry => entry.allowance !== 'read_retry');
  const latest = repairs.at(-1) ?? history.at(-1)!;
  const original = repairs[0] ?? history[0]!;
  const verification = run.lifecycle?.verification.at(-1);
  return <section aria-label="Autonomous recovery history">
    <div className="section-heading"><h4>Autonomous recovery history</h4><Tag>{outcomes[latest.state]}</Tag></div>
    <p className="muted">Recoveries {run.lifecycle!.recoveries}/{run.lifecycle!.policy.maxRecoveries} · corrections {run.lifecycle!.corrections}/{run.lifecycle!.policy.maxCorrections}. Attempts retain the original session, engineering mode, deadline, and cumulative token limit.</p>
    <p>Failure category · {latest.category.replaceAll('_', ' ')}</p>
    <p className="recovery-text">Original blocker · {original.originalBlocker || original.diagnostic}</p>
    <p className="recovery-text">Latest observed action · {run.progress?.latestAction || latest.strategy}</p>
    <p>Latest host verification · {verification ? `${verification.outcome}, exit ${verification.exitCode ?? 'unavailable'}` : 'Not run yet'}. A repaired command alone is not acceptance.</p>
    <div className="run-records">{history.map(entry => {
      const active = ['observed', 'authorized', 'dispatched', 'paused'].includes(entry.state);
      const consumed = Math.max(0, (entry.tokensAfter ?? (active ? total : entry.tokensBefore)) - entry.tokensBefore);
      return <details className="run-record" key={entry.id}>
        <summary><Tag>{outcomes[entry.state]}</Tag> {entry.allowance === 'read_retry' ? `Read retry ${entry.ordinal}` : `${entry.allowance === 'recoveries' ? 'Recovery' : 'Correction'} ${entry.ordinal || 'request'}`} · {entry.category.replaceAll('_', ' ')}</summary>
        <div className="run-record-body">
          <p>{consumed.toLocaleString()} accounted tokens consumed{entry.tokensAfter === undefined && active ? ' so far' : ''}. Author and recorded reviewer usage share the run limit, not a monetary cost cap.</p>
          <p>{new Date(entry.recorded).toLocaleString()}{entry.finished ? ` · ${Math.max(0, Math.round((entry.finished - entry.recorded) / 1000))} seconds elapsed` : ' · Not finished'}</p>
          <h4>Observed failure</h4><pre className="recovery-text" tabIndex={0}>{entry.diagnostic}</pre>
          <h4>Host decision &amp; repair strategy</h4><p className="recovery-text">{entry.strategy}</p>
          <pre className="recovery-text" tabIndex={0}>{entry.instructions || 'No additional repair action authorized.'}</pre>
          <h4>Recorded work</h4><p className="recovery-text">{entry.workPerformed || 'No repair work summary recorded.'}</p>
          <h4>Attempt verification outcomes</h4>
          {entry.verificationIds?.length ? <ul>{run.lifecycle!.verification.filter(receipt => entry.verificationIds!.includes(receipt.id)).map(receipt => <li key={receipt.id}>{receipt.outcome} · exit {receipt.exitCode ?? 'unavailable'} · {receipt.id}</li>)}</ul> : <p className="muted">No host verification linked to this attempt yet.</p>}
          {entry.reviewSessionIds?.length ? <ul>{run.lifecycle!.reviews.filter(review => entry.reviewSessionIds!.includes(review.sessionId)).map(review => <li key={review.sessionId}>Independent review · {review.verdict.replaceAll('_', ' ')} · {review.sessionId}</li>)}</ul> : <p className="muted">No independent review linked to this attempt yet.</p>}
          <h4>Retained original evidence · not current passes</h4>
          {entry.originalEvidence.length ? <ul className="evidence-list">{entry.originalEvidence.map((evidence, index) => <li className="recovery-text" key={index}>{evidence}</li>)}</ul> : <p className="muted">No original criterion evidence reported.</p>}
          {!!entry.originalVerification.length && <ul className="evidence-list">{entry.originalVerification.map(receipt => <li className="recovery-text" key={receipt.id}>{receipt.outcome} · {receipt.criterion} · {receipt.method}</li>)}</ul>}
          <dl className="run-metadata">
            <div><dt>Engineering mode</dt><dd>{entry.engineeringMode === 'standard' ? 'Standard OMP' : 'OMP + pstack'}</dd></div>
            <div><dt>Failure fingerprint</dt><dd className="path">{entry.fingerprint}</dd></div>
            <div><dt>Candidate tree</dt><dd className="path">{entry.candidateTree || 'Not captured'}</dd></div>
            <div><dt>Original revision</dt><dd className="path">{entry.revision}</dd></div>
            {entry.hostVerificationId && <div><dt>Host receipt</dt><dd className="path">{entry.hostVerificationId}</dd></div>}
            {entry.reviewSessionId && <div><dt>Reviewer session</dt><dd className="path">{entry.reviewSessionId}</dd></div>}
          </dl>
        </div>
      </details>;
    })}</div>
  </section>;
}
