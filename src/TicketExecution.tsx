import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, InputNumber, Modal, Select } from 'antd';
import type { ExecutionOverrides, Settings, Snapshot, Ticket } from '../server/contracts';
import type { RequestApi } from './Workspace';

interface Models { models: { provider: string; id: string; name: string }[]; model: string; thinkingLevels: string[] }
interface Props { ticket: Ticket; settings: Settings; api: RequestApi; disabled: boolean; onDirtyChange: (dirty: boolean) => void; execute: (notice: string, work: () => Promise<void>) => Promise<boolean> }
const inherit = '__workspace__';
const different = (a: ExecutionOverrides, b: ExecutionOverrides) => a.engineeringMode !== b.engineeringMode || a.model !== b.model || a.thinking !== b.thinking || a.tokenBudget !== b.tokenBudget;

export default function TicketExecution({ ticket, settings, api, disabled, onDirtyChange, execute }: Props) {
  const [base, setBase] = useState({ execution: ticket.execution ?? {}, version: ticket.executionVersion ?? null, revision: ticket.revision });
  const [draft, setDraft] = useState<ExecutionOverrides>(ticket.execution ?? {});
  const [discovery, setDiscovery] = useState<(Models & { executable: string; requested: string })>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const sequence = useRef(0);
  const [modal, context] = Modal.useModal();
  const dirty = different(draft, base.execution);
  const hasOverrides = Object.values(base.execution).some(value => value !== undefined);
  const stale = base.version !== (ticket.executionVersion ?? null) || base.revision !== ticket.revision;
  const selected = draft.model ?? settings.model;
  const catalogue = discovery?.executable === settings.executable ? discovery : undefined;
  const current = catalogue?.requested === selected && !loading && !error ? catalogue : undefined;
  const unlimited = draft.tokenBudget === null;
  const invalidBudget = draft.tokenBudget !== undefined && draft.tokenBudget !== null && (!Number.isInteger(draft.tokenBudget) || draft.tokenBudget < 1 || draft.tokenBudget > 10000000);
  const needModel = draft.model !== undefined && draft.model !== '' && draft.model !== base.execution.model && current?.model !== draft.model;
  const needThinking = !!draft.thinking && (draft.thinking !== base.execution.thinking || draft.model !== base.execution.model) && !current?.thinkingLevels.includes(draft.thinking);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => { const counter = sequence; return () => { ++counter.current; }; }, []);

  async function discover(model = selected) {
    const request = ++sequence.current;
    setLoading(true); setError('');
    try {
      const result = await api<Models>('/api/settings/models', { method: 'POST', body: JSON.stringify({ executable: settings.executable, model }) });
      if (request === sequence.current) setDiscovery({ ...result, executable: settings.executable, requested: model });
    } catch (cause) { if (request === sequence.current) setError(cause instanceof Error ? cause.message : 'Model discovery failed'); }
    finally { if (request === sequence.current) setLoading(false); }
  }

  const models = [{ value: inherit, label: `Workspace default · ${settings.model || 'OMP default'}` }, { value: '', label: 'OMP configured default' }, ...(catalogue?.models ?? []).map(model => ({ value: `${model.provider}/${model.id}`, label: `${model.name} · ${model.provider}/${model.id}` }))];
  if (draft.model && !models.some(model => model.value === draft.model)) models.push({ value: draft.model, label: `${draft.model} · not verified` });
  const levels = [{ value: inherit, label: draft.model === undefined ? `Workspace default · ${settings.thinking || 'OMP default'}` : 'OMP default' }, { value: '', label: 'OMP default (explicit)' }, ...(current?.thinkingLevels ?? []).map(value => ({ value, label: value }))];
  if (draft.thinking && !levels.some(level => level.value === draft.thinking)) levels.push({ value: draft.thinking, label: `${draft.thinking} · not verified` });

  async function save() {
    const submitted = { ...draft };
    if (!await modal.confirm({ title: 'Save settings for this ticket?', autoFocusButton: 'cancel', okText: 'Save ticket settings', cancelText: 'Keep editing', content: <><p>These settings apply only to the next fresh attempt, not the stopped session or other tickets. A new model may use a different provider. Saving does not approve or retry work; an already Ready ticket remains subject to existing scheduling permission. Budget changes are explicit—compaction never resets consumption.</p>{(submitted.tokenBudget === null || submitted.tokenBudget === undefined && settings.tokenBudget === null) && <p className="warning-text">No cumulative token limit: usage and cost may keep growing until the run finishes, blocks, fails, is paused or reaches its time limit. Native auto-compaction stays enabled. Time limits, safety checks and human acceptance still apply; completion is not guaranteed.</p>}</> })) return;
    setLoadError('');
    await execute('Ticket execution settings saved. No retry requested.', async () => {
      try {
        const saved = await api<Ticket>(`/api/tickets/${encodeURIComponent(ticket.repoId)}/${encodeURIComponent(ticket.id)}/execution`, { method: 'PATCH', body: JSON.stringify({ revision: base.revision, version: base.version, execution: submitted }) });
        setBase({ execution: saved.execution ?? {}, version: saved.executionVersion ?? null, revision: saved.revision });
        setDraft(saved.execution ?? {});
      } catch (cause) { setLoadError(cause instanceof Error ? cause.message : 'Save was not confirmed'); throw cause; }
    });
  }

  return <section className="detail-section ticket-execution" aria-label="Ticket execution settings">
    {context}<details>
    <summary><span className="ticket-execution-title">Next attempt · mode, model &amp; budget</span><span className={dirty ? 'warning-text ticket-execution-summary' : 'muted ticket-execution-summary'}>{dirty ? 'Unsaved ticket settings · expand to edit' : hasOverrides ? 'Ticket overrides saved · expand to edit' : 'Using global settings · expand to customize'}</span></summary>
    <p className="muted">Ticket-specific overrides. Existing runs remain unchanged. Save first, then separately review &amp; retry; partial work and workspace gates remain.</p>
    <div className="form-columns">
      <label>Engineering Mode<Select aria-label="Ticket engineering mode" value={draft.engineeringMode ?? inherit} options={[{ value: inherit, label: `Inherit global · ${settings.engineeringMode === 'standard' ? 'Standard OMP' : 'OMP + pstack'}` }, { value: 'standard', label: 'Standard OMP' }, { value: 'pstack', label: 'OMP + pstack' }]} disabled={disabled} onChange={value => setDraft(draft => ({ ...draft, engineeringMode: value === 'standard' || value === 'pstack' ? value : undefined }))} /><small>Applies to fresh attempts. Existing runs keep their mode and limits; reviewed blocker recovery retains its source run's mode.</small></label>
      <label>Ticket model<Select aria-label="Ticket execution model" showSearch optionFilterProp="label" value={draft.model ?? inherit} options={models} disabled={disabled || loading} onChange={value => {
        const model = value === inherit ? undefined : value;
        setDraft(value => ({ ...value, model, thinking: undefined }));
        void discover(model ?? settings.model);
      }} /></label>
      <label>Ticket thinking level<Select aria-label="Ticket thinking level" value={draft.thinking ?? inherit} options={levels.map(level => ({ ...level, disabled: ![inherit, ''].includes(level.value) && !current?.thinkingLevels.includes(level.value) }))} disabled={disabled || loading} onChange={value => setDraft(draft => ({ ...draft, thinking: value === inherit ? undefined : value }))} /></label>
      <label>Run token budget (optional)<InputNumber<number> aria-label="Ticket token budget" min={1} max={10000000} step={10000} placeholder={unlimited ? 'No cumulative token limit' : settings.tokenBudget === null ? 'Workspace: no cumulative limit' : `Workspace: ${settings.tokenBudget.toLocaleString('en-US')}`} value={draft.tokenBudget ?? null} disabled={disabled || unlimited} status={invalidBudget ? 'error' : undefined} formatter={(value, info) => info.userTyping ? info.input : value === undefined || value === null || String(value) === '' ? '' : Number(value).toLocaleString('en-US')} onChange={value => setDraft(draft => ({ ...draft, tokenBudget: value ?? undefined }))} /><small>Clear to inherit workspace budget{settings.tokenBudget === null ? ' (currently no cumulative limit)' : ''}. Cumulative input/output/cache tokens, not context-window capacity.</small></label>
    </div>
    <Checkbox checked={unlimited} disabled={disabled} onChange={event => setDraft(draft => ({ ...draft, tokenBudget: event.target.checked ? null : undefined }))}>No cumulative token limit</Checkbox>
    {(unlimited || draft.tokenBudget === undefined && settings.tokenBudget === null) && <p className="warning-text">Token use and cost are uncapped{unlimited ? '' : ' · inherited from workspace'} until another stop condition. Time limit: {settings.timeLimitMinutes.toLocaleString('en-US')} minutes for a fresh attempt. Native auto-compaction and all safety/review gates remain.{unlimited && ' Uncheck to inherit the workspace budget.'}</p>}
    <div className="toolbar"><Button disabled={disabled || loading} onClick={() => void discover()}>{error ? 'Retry ticket model discovery' : 'Load ticket models'}</Button><Button type="primary" disabled={disabled || loading || !dirty || stale || !!loadError || invalidBudget || needModel || needThinking} onClick={() => void save()}>Save next-attempt settings</Button></div>
    <p className="muted" role="status">{loading ? 'Discovering models; no ticket execution started.' : dirty ? 'Unsaved ticket execution settings' : 'Ticket execution settings saved or inherited'}</p>
    <p className="muted">Native OMP automatic context compaction is enabled during execution, using its configured threshold. It may consume tokens; any configured token cap and the time limit still apply.</p>
    </details>
    {error && <p className="error-banner" role="alert">{error}. Existing execution settings stay unchanged.</p>}
    {(needModel || needThinking) && <p className="warning-text">Load models to validate changed model/thinking choices before saving.</p>}
    {invalidBudget && <p className="error-banner" role="alert">Enter a whole token budget from 1 to 10,000,000.</p>}
    {(stale || loadError) && <div className="error-banner" role="alert"><p>{loadError || 'Ticket revision or execution settings changed.'} Your selections are preserved. Copy them before loading the current settings.</p><Button disabled={disabled} onClick={async () => {
      if (dirty && !await modal.confirm({ title: 'Replace unsaved execution settings?', okText: 'Load current settings', cancelText: 'Keep editing' })) return;
      await execute('Current ticket settings loaded.', async () => {
        const state = await api<Snapshot>('/api/state'); const current = state.tickets.find(value => value.repoId === ticket.repoId && value.id === ticket.id);
        if (!current || current.removed) throw new Error('Ticket unavailable');
        setBase({ execution: current.execution ?? {}, version: current.executionVersion ?? null, revision: current.revision }); setDraft(current.execution ?? {}); setLoadError('');
      });
    }}>Load current execution settings</Button></div>}
  </section>;
}
