import { Button, Progress, Spin, Tooltip } from 'antd';
import { ArrowsInIcon, BrainIcon, CoinsIcon, CpuIcon, GaugeIcon, InfoIcon, StackIcon } from '@phosphor-icons/react';
import { Link } from 'react-router';
import type { Run } from '../server/contracts';

const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 0 });
const Help = ({ label, text }: { label: string; text: string }) => <Tooltip title={text}><Button type="text" size="small" aria-label={label} icon={<InfoIcon size={16} aria-hidden="true" />} /></Tooltip>;

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
  const model = run.progress?.model ?? (run.configuration ? run.configuration.model || 'OMP default · unresolved' : 'Not recorded');
  return <section className="detail-section run-usage" aria-label="Token usage & compaction">
    <h3><GaugeIcon size={16} aria-hidden="true" />Token usage &amp; compaction</h3>
    <div className="ticket-facts run-usage-facts">
      <p><CpuIcon size={16} aria-hidden="true" /><span>Model</span>{model}</p>
      {run.progress?.thinking && <p><BrainIcon size={16} aria-hidden="true" /><span>Thinking</span>{run.progress.thinking}</p>}
    </div>
    <div className="run-usage-grid">
      <div>
        <h4><CoinsIcon size={16} aria-hidden="true" />Run consumption<Help label="About run consumption" text="Input, output and cache-write tokens, as OMP's goal budget counts them. Cache reads are re-sent context, shown separately and not counted. Compaction cannot refund usage. Not provider billing." /></h4>
        <p className="token-reading">{accountedTotal !== undefined ? `${number(accountedTotal)}${budget ? ` / ${number(budget)}` : ''} tokens` : 'Usage not reported'}{percent !== undefined && <span> · {percent.toFixed(1)}%</span>}</p>
        {percent !== undefined && <Progress percent={Math.min(100, percent)} showInfo={false} status={percent >= 100 ? 'exception' : 'normal'} strokeColor={percent >= 100 ? 'var(--danger)' : 'var(--accent)'} aria-label={`Cumulative token budget ${percent.toFixed(1)} percent used`} />}
        {tokens?.cacheRead !== undefined && <p className="muted">+ {number(tokens.cacheRead)} cache-read tokens · not counted</p>}
        {run.lifecycle && <p className="muted">Author {authorTokens === undefined ? 'not reported' : number(authorTokens)} · Reviewers {reviewerTokens === undefined ? 'not reported' : number(reviewerTokens)}</p>}
        {budget === null && <p className="warning-text">No token limit. Time limit and review gates still apply.</p>}
        {tokens && <small>{active ? 'Sampled' : 'Final sample'} {new Date(tokens.sampled).toLocaleString()}</small>}
      </div>
      <div>
        <h4><StackIcon size={16} aria-hidden="true" />Context window<Help label="About the context window" text="Estimated context sent to the model, separate from consumption. OMP compacts at its own threshold, not at the run budget. Provider usage and local estimates may differ." /></h4>
        <p className="token-reading">{context ? `${number(context.tokens)} / ${number(context.window)} tokens · ${contextPercent!.toFixed(1)}%` : 'Not reported'}</p>
        {contextPercent !== undefined && <Progress percent={Math.min(100, contextPercent)} showInfo={false} status="normal" strokeColor="var(--accent)" aria-label={`Context window ${contextPercent.toFixed(1)} percent used`} />}
        {context && <small>{active ? 'Sampled' : 'Last snapshot'} {new Date(context.sampled).toLocaleString()}</small>}
        <div className="run-compaction" aria-label="Native compaction status">
          <h4><ArrowsInIcon size={16} aria-hidden="true" />Compaction<Help label="About compaction" text="Threshold and background summaries are managed by OMP and not reported. Last-compaction time is observed by the dashboard, not an OMP timestamp." /></h4>
          <p role="status">{compaction?.active && ['running', 'stopping'].includes(run.status) ? <><Spin size="small" /> Compacting context…</> : compaction?.enabled === true ? 'Automatic · native OMP' : compaction?.enabled === false ? 'Disabled' : 'Not reported'}</p>
          <p className="muted">Last: {compaction?.lastCompletedAt ? new Date(compaction.lastCompletedAt).toLocaleString() : 'none recorded'}</p>
          {compaction?.lastEvent && <p className="muted">{compaction.lastEvent}</p>}
        </div>
      </div>
    </div>
    {run.status === 'failed' && !run.error?.startsWith('Execution token budget exhausted') && <p className="warning-text">Failed runs don't resume. Check partial work, then <Link to={`/projects/${encodeURIComponent(run.repoId)}/tickets/${encodeURIComponent(run.ticketId)}`}>review &amp; retry on the ticket</Link>.</p>}
  </section>;
}
