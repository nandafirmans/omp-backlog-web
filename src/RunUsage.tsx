import { Progress, Spin } from 'antd';
import { Link } from 'react-router';
import type { Run } from '../server/contracts';

const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 0 });
export default function RunUsage({ run }: { run: Run }) {
  const { tokens, context, compaction } = run.progress ?? {};
  const budget = run.progress?.tokenBudget === undefined ? run.configuration?.tokenBudget : run.progress.tokenBudget;
  const authorTokens = run.lifecycle?.authorTokens;
  const reviewerTokens = run.lifecycle?.reviewerTokens;
  const lifecycleTotal = authorTokens === undefined ? undefined : authorTokens + (reviewerTokens ?? 0);
  const accountedTotal = tokens ? Math.max(tokens.total, lifecycleTotal ?? 0) : lifecycleTotal;
  const percent = accountedTotal !== undefined && budget && budget > 0 ? accountedTotal / budget * 100 : undefined;
  const contextPercent = context ? context.tokens / context.window * 100 : undefined;
  const active = ['running', 'stopping', 'paused'].includes(run.status);
  const model = run.progress?.model ?? (run.configuration ? run.configuration.model || 'OMP configured default · unresolved' : 'Not recorded for this run');
  return <section className="detail-section run-usage" aria-label="Token usage & compaction">
    <h3>Token usage &amp; compaction</h3>
    <p className="run-usage-model">Model: <strong>{model}</strong>{run.progress?.thinking && ` · thinking ${run.progress.thinking}`}</p>
    <p>Engineering Mode: <strong>{run.configuration?.engineeringMode === 'standard' ? 'Standard OMP' : 'OMP + pstack'}</strong>{!run.configuration?.engineeringMode && ' · legacy mode'}</p>
    <div className="run-usage-grid">
      <div><h4>Cumulative run consumption · accounted tokens</h4><p className="token-reading">{accountedTotal !== undefined ? `${number(accountedTotal)}${budget ? ` / ${number(budget)}` : ''} tokens` : 'Usage not reported'}{percent !== undefined && <span> · {percent.toFixed(1)}%</span>}</p>
        {run.lifecycle && <p className="muted">Author: {authorTokens === undefined ? 'not reported' : `${number(authorTokens)} tokens`} · Independent reviewers: {reviewerTokens === undefined ? 'not reported' : `${number(reviewerTokens)} tokens`}. Recorded reviewer consumption is included in the total, not added twice.</p>}
        {budget === null && <p className="warning-text">No cumulative token limit · usage and cost remain uncapped. Time limit and safety/review gates still apply.</p>}
        {percent !== undefined && <Progress percent={Math.min(100, percent)} showInfo={false} status={percent >= 100 ? 'exception' : 'normal'} strokeColor={percent >= 100 ? 'var(--danger)' : 'var(--accent)'} aria-label={`Cumulative token budget ${percent.toFixed(1)} percent used`} />}
        <p className="muted">Input, output and repeated context/cache count. Compaction cannot refund consumed tokens. These are accounted tokens, not actual provider billing or a spending limit. Provider charges and any unreported usage are not available here.</p>
        {tokens && <small>{active ? 'Last sampled' : 'Final recorded sample'}: {new Date(tokens.sampled).toLocaleString()}. Usage can overshoot between samples.</small>}
      </div>
      <div><h4>Current context window · estimate</h4><p className="token-reading">{context ? `${number(context.tokens)} / ${number(context.window)} tokens · ${contextPercent!.toFixed(1)}%` : 'Current context not reported'}</p>
        {contextPercent !== undefined && <Progress percent={Math.min(100, contextPercent)} showInfo={false} status="normal" strokeColor="var(--accent)" aria-label={`Context window ${contextPercent.toFixed(1)} percent used`} />}
        <div className="run-compaction" aria-label="Native compaction status">
          <p role="status">{compaction?.active && ['running', 'stopping'].includes(run.status) ? <><Spin size="small" /> Compacting context…</> : `Automatic compaction: ${compaction?.enabled === true ? 'enabled · native OMP' : compaction?.enabled === false ? 'disabled' : 'not reported for this run'}`}</p>
          <p className="muted">Threshold managed by OMP · not reported through RPC. Background summary activity is not reported.</p>
          <p className="muted">Last successful compaction reported: {compaction?.lastCompletedAt ? new Date(compaction.lastCompletedAt).toLocaleString() : 'not recorded for this run'}. {compaction?.lastCompletedAt && 'Time observed by dashboard, not an OMP execution timestamp.'}</p>
          {compaction?.lastEvent && <p className="muted">{compaction.lastEvent}</p>}
        </div>
        <p className="muted">Context sent to the model, separate from cumulative consumption. Native OMP compacts at its configured threshold—not at the run budget.</p>
        {context && <small>{active ? 'Context sampled' : 'Last context snapshot'}: {new Date(context.sampled).toLocaleString()}. Provider usage and local estimation may differ.</small>}
      </div>
    </div>
    {run.status === 'failed' && <p className="warning-text">A failed run is stopped, not resumed by changing models. <Link to={`/projects/${encodeURIComponent(run.repoId)}/tickets/${encodeURIComponent(run.ticketId)}`}>Configure model/budget for this ticket’s next attempt</Link>, reconcile partial work, then explicitly review &amp; retry.</p>}
  </section>;
}
