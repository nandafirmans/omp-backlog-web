import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Button, Input, InputNumber, Modal, Select, Tag } from 'antd';
import { useBlocker } from 'react-router';
import type { Repo, VerificationRecipe } from '../server/contracts';
import type { RequestApi } from './Workspace';
import { commissionedRecipe, completionDraft } from './completionPolicy';

interface Props {
  repo: Repo;
  api: RequestApi;
  execute: (notice: string, work: () => Promise<void>) => Promise<boolean>;
  busy: boolean;
  owned: boolean;
  onClose: () => void;
}

export default function CompletionPolicy({ repo, api, execute, busy, owned, onClose }: Props) {
  const [base, setBase] = useState(repo.completion);
  const [draft, setDraft] = useState(() => completionDraft(repo.completion));
  const [error, setError] = useState('');
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

  async function close() {
    if (busy) return;
    if (dirty && !await modal.confirm({ title: 'Discard unsaved completion policy?', content: 'No completion authority has been changed. Your unsaved command and policy edits will be discarded.', focusable: { autoFocusButton: 'cancel' }, okText: 'Discard changes', cancelText: 'Keep editing', okButtonProps: { danger: true } })) return;
    onClose();
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || stale || !dirty && draft.mode === 'human' || draft.mode === 'autonomous' && (owned || !repo.git || !!repo.handoff)) return;
    setError('');
    let verification: VerificationRecipe | undefined;
    try { if (draft.mode === 'autonomous') verification = commissionedRecipe(draft); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return; }
    if (draft.mode === 'autonomous' && !await modal.confirm({ title: 'Save authorized autonomous policy?', focusable: { autoFocusButton: 'cancel' }, okText: 'Authorize local commit & Done', cancelText: 'Keep editing', content: <><p>This commissions the current bytes of your listed recipe files. This project may run the exact command you entered, independently review the candidate, make a local Git commit, and mark the exact ticket revision Done without routine human acceptance.</p><p>No push, pull request, merge or deployment is authorized. OMP and verification commands run with the backend OS user's permissions; this is not a sandbox. Exceptions stop for operator assistance.</p><p>Start permission remains separate and is not changed by this action.</p></> })) return;
    await execute('Project completion policy saved.', async () => {
      const saved = await api<Repo>(`/api/repos/${encodeURIComponent(repo.id)}/completion`, { method: 'PATCH', body: JSON.stringify({ revision: base?.revision ?? null, mode: draft.mode, ...(draft.mode === 'autonomous' ? { confirm: true, verification, reviewerModel: draft.reviewerModel.trim(), maxCorrections: draft.maxCorrections, maxRecoveries: draft.maxRecoveries } : {}) }) });
      setBase(saved.completion);
      setDraft(completionDraft(saved.completion));
    });
  }

  return <>{context}<Modal title="Project completion policy" open onCancel={() => void close()} footer={null} width={760} style={{ top: 24 }} mask={{ closable: false }} className="completion-policy-modal">
    <form className="completion-policy-form" onSubmit={event => void save(event)}>
      <p>Completion is separate from execution permission. Human review is the default; saving this policy does not start work or enable the scheduler.</p>
      <p className="path">Saved policy revision: {base?.revision ?? 'Not configured · human review default'}</p>
      <label htmlFor="completion-mode">Completion authority</label>
      <Select id="completion-mode" value={draft.mode} disabled={busy} onChange={mode => setDraft(value => ({ ...value, mode }))} options={[{ value: 'human', label: 'Human review · operator accepts Done' }, { value: 'autonomous', label: 'Autonomous · verified local commit & Done' }]} />
      {draft.mode === 'autonomous' && <>
        <p className="warning-text">Explicit owner commissioning required. No recipe discovery, installation, push, PR, merge or deploy. Recipe contents are pinned when saved; changes require saving the policy again.</p>
        {!repo.git && <p role="alert" className="error-banner">Autonomous completion requires a Git repository.</p>}
        <label htmlFor="completion-argv">Host verification command · argv JSON array</label>
        <Input.TextArea id="completion-argv" value={draft.argv} disabled={busy} rows={4} placeholder={'["executable", "argument", "path/to/verification-script"]'} onChange={event => setDraft(value => ({ ...value, argv: event.target.value }))} aria-describedby="completion-argv-help" />
        <p id="completion-argv-help" className="muted">Enter the exact executable and each argument separately. This is not shell syntax. Only commission a command you trust for this project's acceptance criteria.</p>
        <label htmlFor="completion-files">Verification recipe files · one repository-relative path per line</label>
        <Input.TextArea id="completion-files" value={draft.files} disabled={busy} rows={4} onChange={event => setDraft(value => ({ ...value, files: event.target.value }))} aria-describedby="completion-files-help" />
        <p id="completion-files-help" className="muted">List existing scripts, manifests and recipe instructions that define the command. The host fingerprints their bytes; this project's recipe does not verify other projects.</p>
        <label htmlFor="completion-reviewer">Independent reviewer model</label>
        <Input id="completion-reviewer" value={draft.reviewerModel} disabled={busy} onChange={event => setDraft(value => ({ ...value, reviewerModel: event.target.value }))} placeholder="provider/model · blank uses attempt model" aria-describedby="completion-reviewer-help" />
        <p id="completion-reviewer-help" className="muted">Leave blank to use the snapshotted attempt model, or enter an exact provider/model. A separate restricted OMP session reviews source, the candidate diff and criterion evidence; a separate session does not imply model-family diversity. Agent conclusions remain distinct from host-executed checks.</p>
        <div className="completion-policy-limits">
          <label htmlFor="completion-timeout">Command timeout (seconds)<InputNumber id="completion-timeout" min={1} max={1800} precision={0} value={draft.timeoutSeconds} disabled={busy} onChange={timeoutSeconds => setDraft(value => ({ ...value, timeoutSeconds }))} /></label>
          <label htmlFor="completion-corrections">Maximum corrections<InputNumber id="completion-corrections" min={0} max={2} precision={0} value={draft.maxCorrections} disabled={busy} onChange={maxCorrections => setDraft(value => ({ ...value, maxCorrections }))} /></label>
          <label htmlFor="completion-recoveries">Maximum recoveries<InputNumber id="completion-recoveries" min={0} max={1} precision={0} value={draft.maxRecoveries} disabled={busy} onChange={maxRecoveries => setDraft(value => ({ ...value, maxRecoveries }))} /></label>
        </div>
        <p className="muted">All roles share the attempt's original deadline and cumulative token limit. Recoveries cover incomplete verification and host-reproduced engineering blockers together. Failed host checks and reviewer findings share the correction limit. Credentials, installations, product decisions, exhausted limits, and uncertain operations require assistance. No budget reset or expanded permission is granted.</p>
        {base?.mode === 'autonomous' && <details><summary>Pinned saved recipe identity</summary><p className="path">{base.recipeHash}</p></details>}
        <p className="muted">Save again to explicitly recommission changed recipe bytes, even when these form values are unchanged.</p>
      </>}
      {draft.mode === 'human' && <p>Completed work waits for human acceptance. Disabling autonomous completion revokes future privileged lifecycle transitions; it does not undo a local commit or roll back work.</p>}
      {owned && <p className="warning-text">An active or paused run owns this workspace. Autonomous enabling or configuration changes are unavailable until ownership settles; you can still save Human review to revoke authority.</p>}
      {repo.handoff && draft.mode === 'autonomous' && <p className="warning-text">Reconcile the recorded workspace gate before commissioning autonomous completion. Existing Review &amp; commit and Recheck workspace controls are unchanged.</p>}
      {stale && <p className="error-banner" role="alert">The saved policy changed elsewhere. Your draft is preserved. Load the current saved policy before saving again.</p>}
      {error && <p className="error-banner" role="alert">{error}</p>}
      <div className="toolbar completion-policy-actions">
        <Tag>{dirty ? 'Unsaved changes' : 'Saved policy'}</Tag>
        <Button disabled={busy} onClick={async () => { if (dirty && !await modal.confirm({ title: 'Replace unsaved completion policy?', content: 'Load the saved policy and discard your unsaved form edits?', focusable: { autoFocusButton: 'cancel' }, okText: 'Load saved policy', cancelText: 'Keep editing' })) return; setBase(repo.completion); setDraft(completionDraft(repo.completion)); setError(''); }}>Load saved policy</Button>
        <Button onClick={() => void close()} disabled={busy}>Close</Button>
        <Button type="primary" htmlType="submit" disabled={busy || !dirty && draft.mode === 'human' || stale || draft.mode === 'autonomous' && (!repo.git || owned || !!repo.handoff)}>{draft.mode === 'autonomous' && !dirty ? 'Recommission saved recipe' : 'Save completion policy'}</Button>
      </div>
    </form>
  </Modal><Modal title="Leave unsaved completion policy?" open={blocker.state === 'blocked'} okText="Discard changes" cancelText="Keep editing" onOk={() => { if (blocker.state === 'blocked') { onClose(); blocker.proceed(); } }} onCancel={() => blocker.state === 'blocked' && blocker.reset()}><p>Your unsaved completion policy will be discarded. Saved authority is unchanged.</p></Modal></>;
}
