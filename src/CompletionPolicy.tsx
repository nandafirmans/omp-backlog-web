import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Button, Input, InputNumber, Modal, Select, Tag } from 'antd';
import { useBlocker } from 'react-router';
import type { CheckSuggestion, CheckTrial, Repo, Settings, VerificationRecipe } from '../server/contracts';
import type { RequestApi } from './Workspace';
import { commandText, commissionedRecipe, completionDraft, parseCommand } from './completionPolicy';
import type { CompletionDraft } from './completionPolicy';

interface Props {
  repo: Repo;
  settings: Settings;
  api: RequestApi;
  execute: (notice: string, work: () => Promise<void>) => Promise<boolean>;
  busy: boolean;
  owned: boolean;
  onClose: () => void;
}

export default function CompletionPolicy({ repo, settings, api, execute, busy, owned, onClose }: Props) {
  const [base, setBase] = useState(repo.completion);
  const [draft, setDraft] = useState(() => completionDraft(repo.completion));
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<{ status: 'loading' | 'ready' | 'error'; items: CheckSuggestion[]; message?: string }>({ status: 'loading', items: [] });
  const [trial, setTrial] = useState<{ status: 'idle' | 'running' | 'done' | 'error'; command?: string; result?: CheckTrial; message?: string }>({ status: 'idle' });
  const [models, setModels] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; items: { value: string; label: string }[]; message?: string }>({ status: 'idle', items: [] });
  const [modal, context] = Modal.useModal();
  const dirty = JSON.stringify(draft) !== JSON.stringify(completionDraft(base));
  const stale = (repo.completion?.revision ?? null) !== (base?.revision ?? null);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    const controller = new AbortController();
    api<CheckSuggestion[]>(`/api/repos/${encodeURIComponent(repo.id)}/check-suggestions`, { signal: controller.signal })
      .then(items => { setSuggestions({ status: 'ready', items }); if (items[0]) setDraft(value => autoFilled(value, items[0])); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setSuggestions({ status: 'error', items: [], message: cause instanceof Error ? cause.message : String(cause) }); });
    return () => controller.abort();
  }, [api, repo.id]);

  // Only an empty Autonomous form is filled; typed or saved commands are never replaced.
  function autoFilled(value: CompletionDraft, suggestion: CheckSuggestion): CompletionDraft {
    return value.mode === 'autonomous' && !value.argv.trim() ? { ...value, argv: commandText(suggestion.argv), files: value.files.trim() ? value.files : suggestion.files.join('\n') } : value;
  }

  function pickSuggestion(suggestion: CheckSuggestion) {
    setDraft(value => ({ ...value, argv: commandText(suggestion.argv), files: value.files.trim() ? value.files : suggestion.files.join('\n') }));
  }

  async function runTrial() {
    const command = draft.argv;
    let argv: unknown;
    try { argv = parseCommand(command); } catch (cause) { setTrial({ status: 'error', command, message: cause instanceof Error ? cause.message : String(cause) }); return; }
    setTrial({ status: 'running', command });
    try {
      const result = await api<CheckTrial>(`/api/repos/${encodeURIComponent(repo.id)}/check-trial`, { method: 'POST', body: JSON.stringify({ argv, timeoutSeconds: draft.timeoutSeconds ?? 300 }) });
      setTrial({ status: 'done', command, result });
    } catch (cause) { setTrial({ status: 'error', command, message: cause instanceof Error ? cause.message : String(cause) }); }
  }

  async function loadModels() {
    setModels({ status: 'loading', items: [] });
    try {
      const result = await api<{ models: { provider: string; id: string; name: string }[] }>('/api/settings/models', { method: 'POST', body: JSON.stringify({ executable: settings.executable, model: settings.model }) });
      setModels({ status: 'ready', items: result.models.map(model => ({ value: `${model.provider}/${model.id}`, label: `${model.name} · ${model.provider}/${model.id}` })) });
    } catch (cause) { setModels({ status: 'error', items: [], message: cause instanceof Error ? cause.message : String(cause) }); }
  }

  const trialCurrent = trial.command === draft.argv;
  const trialPassed = trial.status === 'done' && trial.result?.exitCode === 0;
  const reviewerOptions = [{ value: '', label: `Same model as the run (${settings.model || 'OMP default'})` }, ...models.items.filter(model => model.value !== settings.model)];
  if (draft.reviewerModel && !reviewerOptions.some(option => option.value === draft.reviewerModel)) reviewerOptions.push({ value: draft.reviewerModel, label: draft.reviewerModel });

  async function close() {
    if (busy) return;
    if (dirty && !await modal.confirm({ title: 'Discard your changes?', content: 'Your edits will be lost. The saved setting stays as it is.', focusable: { autoFocusButton: 'cancel' }, okText: 'Discard changes', cancelText: 'Keep editing', okButtonProps: { danger: true } })) return;
    onClose();
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || stale || !dirty && draft.mode === 'human' || draft.mode === 'autonomous' && (owned || !repo.git || !!repo.handoff)) return;
    setError('');
    let verification: VerificationRecipe | undefined;
    try { if (draft.mode === 'autonomous') verification = commissionedRecipe(draft); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return; }
    if (draft.mode === 'autonomous' && !await modal.confirm({ title: 'Turn on autonomous completion?', focusable: { autoFocusButton: 'cancel' }, okText: 'Allow commit & Done', cancelText: 'Keep editing', content: <><p>When a ticket's check command passes and the reviewer agrees, this app will make a local Git commit and mark the ticket Done without asking you.</p><p>It never pushes, opens pull requests, merges or deploys. The agent and the check command run with your user's permissions, not in a sandbox. Anything unexpected stops and waits for you.</p><p>Whether tickets start on their own is a separate setting and is not changed.</p></> })) return;
    await execute('Project completion policy saved.', async () => {
      const saved = await api<Repo>(`/api/repos/${encodeURIComponent(repo.id)}/completion`, { method: 'PATCH', body: JSON.stringify({ revision: base?.revision ?? null, mode: draft.mode, ...(draft.mode === 'autonomous' ? { confirm: true, verification, reviewerModel: draft.reviewerModel.trim(), maxCorrections: draft.maxCorrections, maxRecoveries: draft.maxRecoveries } : {}) }) });
      setBase(saved.completion);
      setDraft(completionDraft(saved.completion));
    });
  }

  return <>{context}<Modal title="Who marks tickets Done" open onCancel={() => void close()} footer={null} width={760} style={{ top: 24 }} mask={{ closable: false }} className="completion-policy-modal">
    <form className="completion-policy-form" onSubmit={event => void save(event)}>
      <p>Choose what happens when an agent finishes a ticket. Saving does not start any work.</p>
      <p className="muted">Saved setting: {base?.mode === 'autonomous' ? 'Autonomous' : base ? 'Human review' : 'Human review (default)'}</p>
      <label htmlFor="completion-mode">Completion mode</label>
      <Select id="completion-mode" value={draft.mode} disabled={busy} onChange={mode => setDraft(value => { const next = { ...value, mode }; return suggestions.items[0] ? autoFilled(next, suggestions.items[0]) : next; })} options={[{ value: 'human', label: 'Human review: you accept each ticket' }, { value: 'autonomous', label: 'Autonomous: commit and Done when checks pass' }]} />
      {draft.mode === 'autonomous' && <>
        <p className="warning-text">After the check command passes and a second agent approves the diff, this app commits locally and marks the ticket Done without you. It never pushes, deploys or installs packages.</p>
        {!repo.git && <p role="alert" className="error-banner">Autonomous completion requires a Git repository.</p>}
        <label htmlFor="completion-argv">Check command</label>
        <div className="completion-policy-suggestions" aria-live="polite">
          {suggestions.status === 'loading' && <p className="muted">Looking for test commands in this project…</p>}
          {suggestions.status === 'error' && <p className="muted">Could not detect a test command ({suggestions.message}). Type one below instead.</p>}
          {suggestions.status === 'ready' && !suggestions.items.length && <p className="muted">No test command detected (checked package.json, Makefile, Cargo.toml, go.mod and pytest config). Type the command you run to test this project.</p>}
          {suggestions.status === 'ready' && !!suggestions.items.length && <>
            <p className="muted">Filled in from this project's files. To use a different one, click it:</p>
            <div className="toolbar">{suggestions.items.map(item => <Button key={item.name} disabled={busy} onClick={() => pickSuggestion(item)} title={item.script} aria-label={`Use ${commandText(item.argv)}: ${item.script}`}>{commandText(item.argv)}</Button>)}</div>
          </>}
        </div>
        <Input id="completion-argv" value={draft.argv} disabled={busy} placeholder="npm test" onChange={event => setDraft(value => ({ ...value, argv: event.target.value }))} aria-describedby="completion-argv-help" />
        <div className="toolbar"><Button disabled={busy || trial.status === 'running' || !draft.argv.trim()} onClick={() => void runTrial()}>{trial.status === 'running' ? 'Running check…' : 'Run check now'}</Button></div>
        <div aria-live="polite" className="completion-policy-trial">
          {trial.status === 'error' && trialCurrent && <p className="error-banner" role="alert">{trial.message}</p>}
          {trial.status === 'done' && trial.result && <>
            <p className={trialPassed ? '' : 'warning-text'}>
              {trialPassed ? <strong>Check passed</strong> : trial.result.error ? trial.result.error : trial.result.timedOut ? `Check timed out after ${draft.timeoutSeconds ?? 300} seconds.` : `Check failed with exit code ${trial.result.exitCode}. Fix the project or pick another command; Autonomous would stop every ticket on this.`}
              {trialPassed && ` in ${(trial.result.durationMs / 1000).toFixed(1)}s.`}
              {!trialCurrent && ' (The command changed since this run.)'}
            </p>
            {!!trial.result.output && <details open={!trialPassed}><summary>Output{trial.result.truncated ? ' (last 64 KB)' : ''}</summary><pre>{trial.result.output}</pre></details>}
          </>}
        </div>
        <p id="completion-argv-help" className="muted">The command you would type to run this project's tests. Exit code 0 means pass. Run check now tries it once in the project folder; it changes no settings. Several steps? Put them in one script or Makefile target.</p>
        <label htmlFor="completion-files">Files that define the check</label>
        <Input.TextArea id="completion-files" value={draft.files} disabled={busy} rows={2} placeholder="Makefile" onChange={event => setDraft(value => ({ ...value, files: event.target.value }))} aria-describedby="completion-files-help" />
        <p id="completion-files-help" className="muted">Filled in automatically, for example package.json, Makefile or go.mod. One path per line. These files are locked so an agent cannot weaken the check: if a ticket edits one, it stops and waits for you.</p>
        <details className="completion-policy-advanced">
          <summary>Advanced settings (defaults are fine)</summary>
          <label htmlFor="completion-reviewer">Reviewer model</label>
          <Select id="completion-reviewer" showSearch optionFilterProp="label" value={draft.reviewerModel} disabled={busy} options={reviewerOptions} onChange={reviewerModel => setDraft(value => ({ ...value, reviewerModel }))} aria-describedby="completion-reviewer-help" />
          <div className="toolbar"><Button disabled={busy || models.status === 'loading'} onClick={() => void loadModels()}>{models.status === 'loading' ? 'Loading models…' : models.status === 'error' ? 'Retry loading models' : 'Load models'}</Button></div>
          {models.status === 'error' && <p className="error-banner" role="alert">Could not load models: {models.message}</p>}
          <p id="completion-reviewer-help" className="muted">A separate read-only agent session reviews the diff against each acceptance criterion. For a real second opinion, click Load models and pick a different one.</p>
          <div className="completion-policy-limits">
            <label htmlFor="completion-timeout">Check timeout (seconds)<InputNumber id="completion-timeout" min={1} max={1800} precision={0} value={draft.timeoutSeconds} disabled={busy} onChange={timeoutSeconds => setDraft(value => ({ ...value, timeoutSeconds }))} /></label>
            <label htmlFor="completion-corrections">Fix attempts (0–2)<InputNumber id="completion-corrections" min={0} max={2} precision={0} value={draft.maxCorrections} disabled={busy} onChange={maxCorrections => setDraft(value => ({ ...value, maxCorrections }))} /></label>
            <label htmlFor="completion-recoveries">Recovery retries (0–1)<InputNumber id="completion-recoveries" min={0} max={1} precision={0} value={draft.maxRecoveries} disabled={busy} onChange={maxRecoveries => setDraft(value => ({ ...value, maxRecoveries }))} /></label>
          </div>
          <p className="muted">Fix attempts: how often the agent may fix its work after a failed check or reviewer findings. Recovery retries: one retry after an unfinished check or a blocker the app can reproduce. All of it shares the run's time and token budget. Anything needing credentials, installs or a product decision stops and waits for you.</p>
        </details>
        {base?.mode === 'autonomous' && <details><summary>Locked files fingerprint</summary><p className="path">{base.recipeHash}</p></details>}
        {base?.mode === 'autonomous' && <p className="muted">Changed a listed file on purpose? Save again to lock the new version.</p>}
      </>}
      {draft.mode === 'human' && <p>Finished tickets wait in Needs review until you accept them. Switching back from Autonomous does not undo commits already made.</p>}
      {owned && <p className="warning-text">A run is active or paused in this project. Wait for it to finish before turning on or changing Autonomous. You can still switch to Human review.</p>}
      {repo.handoff && draft.mode === 'autonomous' && <p className="warning-text">This project has leftover changes from an earlier run. Resolve them with Review &amp; commit or Recheck workspace before turning on Autonomous.</p>}
      {stale && <p className="error-banner" role="alert">This setting was changed somewhere else. Your edits are kept. Click Reset to saved to load the latest before saving.</p>}
      {error && <p className="error-banner" role="alert">{error}</p>}
      <div className="toolbar completion-policy-actions">
        <Tag>{dirty ? 'Unsaved changes' : 'Saved'}</Tag>
        <Button disabled={busy} onClick={async () => { if (dirty && !await modal.confirm({ title: 'Reset to saved setting?', content: 'Your unsaved edits will be lost.', focusable: { autoFocusButton: 'cancel' }, okText: 'Reset', cancelText: 'Keep editing' })) return; setBase(repo.completion); setDraft(completionDraft(repo.completion)); setError(''); }}>Reset to saved</Button>
        <Button onClick={() => void close()} disabled={busy}>Close</Button>
        <Button type="primary" htmlType="submit" disabled={busy || !dirty && draft.mode === 'human' || stale || draft.mode === 'autonomous' && (!repo.git || owned || !!repo.handoff)}>{draft.mode === 'autonomous' && !dirty ? 'Re-lock files' : 'Save'}</Button>
      </div>
    </form>
  </Modal><Modal title="Leave without saving?" open={blocker.state === 'blocked'} okText="Discard changes" cancelText="Keep editing" onOk={() => { if (blocker.state === 'blocked') { onClose(); blocker.proceed(); } }} onCancel={() => blocker.state === 'blocked' && blocker.reset()}><p>Your edits will be lost. The saved setting stays as it is.</p></Modal></>;
}
