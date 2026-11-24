import { ArrowCounterClockwiseIcon, CoinsIcon, XIcon } from '@phosphor-icons/react';
import { Button, InputNumber, Modal } from 'antd';
import type { Run, Ticket } from '../server/contracts';
import type { RequestApi } from './Workspace';

export const budgetExhausted = (run: Run) => run.status === 'failed' && !!run.error?.startsWith('Execution token budget exhausted');
const encode = encodeURIComponent;
const MAX_BUDGET = 10000000;

interface Props { run: Run; ticket: Ticket; api: RequestApi; execute: (notice: string, work: () => Promise<void>) => Promise<boolean>; busy: boolean }

/** Failed-by-budget run: raise this ticket's cap and queue a fresh, reviewed retry in one confirmed step. */
export default function BudgetRetry({ run, ticket, api, execute, busy }: Props) {
  const [modal, context] = Modal.useModal();
  const used = run.progress?.tokens?.total ?? 0;
  const previous = run.progress?.tokenBudget ?? run.configuration?.tokenBudget ?? 0;
  // Double the larger of cap or usage, rounded up to the next 100k; never below the 500k default.
  const suggested = Math.min(MAX_BUDGET, Math.max(500000, Math.ceil(Math.max(previous, used) * 2 / 100000) * 100000));
  const current = ticket.runId === run.id && ticket.status === 'failed' && ticket.revision === run.revision && !ticket.error;

  async function retry() {
    let budget: number | null = suggested;
    const ok = await modal.confirm({
      title: <span className="icon-heading"><CoinsIcon size={16} aria-hidden="true" />Retry with a higher budget?</span>,
      width: 480, autoFocusButton: 'cancel',
      content: <>
        <p>Used {used.toLocaleString('en-US')} of {previous.toLocaleString('en-US')} tokens.</p>
        <label className="budget-retry-field"><span>New ticket budget</span><InputNumber<number> aria-label="New ticket token budget" min={Math.max(1, used + 1)} max={MAX_BUDGET} step={100000} defaultValue={suggested} formatter={value => value === undefined ? '' : Number(value).toLocaleString('en-US')} parser={value => Number((value ?? '').replace(/,/g, ''))} onChange={value => { budget = value; }} suffix={<CoinsIcon size={16} aria-hidden="true" />} /></label>
        <p className="muted">Starts a fresh session. Partial changes stay; nothing is rolled back.</p>
      </>,
      okText: 'Save & retry', okButtonProps: { icon: <ArrowCounterClockwiseIcon size={16} aria-hidden="true" /> },
      cancelText: 'Cancel', cancelButtonProps: { icon: <XIcon size={16} aria-hidden="true" /> },
    });
    if (!ok || budget === null || !Number.isInteger(budget) || budget < 1 || budget > MAX_BUDGET) return;
    const tokenBudget = budget;
    await execute(`Budget set to ${tokenBudget.toLocaleString('en-US')}. Retry queued.`, async () => {
      const path = `/api/tickets/${encode(ticket.repoId)}/${encode(ticket.id)}`;
      const saved = await api<Ticket>(`${path}/execution`, { method: 'PATCH', body: JSON.stringify({ revision: ticket.revision, version: ticket.executionVersion ?? null, execution: { ...ticket.execution, tokenBudget } }) });
      await api(`${path}/action`, { method: 'POST', body: JSON.stringify({ action: 'retry', revision: saved.revision, executionVersion: saved.executionVersion ?? null }) });
    });
  }

  if (ticket.runId === run.id && ticket.status === 'ready') return <p className="muted" role="status">Retry queued at {(ticket.execution?.tokenBudget ?? previous).toLocaleString('en-US')} tokens. Waiting for the scheduler; check the project if it doesn't start.</p>;
  return <>{context}<Button icon={<ArrowCounterClockwiseIcon size={16} aria-hidden="true" />} type="primary" disabled={busy || !current} title={current ? undefined : 'Only the latest failed run of the current revision can be retried'} onClick={() => void retry()}>Retry with higher budget</Button></>;
}
