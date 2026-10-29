import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Button, Spin, Tag } from 'antd';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Run, TranscriptEntry } from '../server/contracts';
import { toolPresentation } from './transcript-presentation';
import TranscriptCode from './TranscriptCode';
import './RunTranscript.css';

const markdownComponents: Components = {
  a: ({ href, children }) => <a href={href} rel="noreferrer">{children}</a>,
  // Agent output must not fetch remote images just because a run is opened.
  img: ({ src, alt }) => <span className="run-transcript-image">Image reference: {src ? <a href={src} rel="noreferrer">{alt || 'Open image'}</a> : alt || '(unavailable)'}</span>,
  pre: ({ children }) => <>{children}</>,
  table: ({ children }) => <div className="markdown-table" role="region" aria-label="Scrollable transcript table" tabIndex={0}><table>{children}</table></div>,
  code: ({ children, className }) => className?.startsWith('language-') || String(children).includes('\n')
    ? <TranscriptCode text={String(children).replace(/\n$/, '')} languageHint={className?.replace(/^language-/, '')} />
    : <code>{children}</code>,
};

function EntryStatus({ state }: { state: TranscriptEntry['state'] }) {
  if (!state) return null;
  return <Tag className={`run-transcript-status run-transcript-status-${state}`}>{state === 'running' ? 'Running' : state === 'error' ? 'Error' : 'Complete'}</Tag>;
}

const ToolEntry = memo(function ToolEntry({ entry, onInspect }: { entry: TranscriptEntry; onInspect: () => void }) {
  const presentation = toolPresentation(entry);
  const lines = presentation.content.split('\n').length;
  const truncated = /\[Truncated[^\]]*\]/.test(`${entry.input ?? ''}\n${entry.output ?? ''}\n${entry.diff ?? ''}`);
  const editWithoutDiff = /(?:^|[._])(?:edit|apply_patch)$/.test(entry.toolName ?? '') && presentation.format !== 'diff';
  return <details className={`run-transcript-tool${entry.state === 'error' ? ' run-transcript-error' : ''}`} data-entry-id={entry.id} data-state={entry.state}>
    <summary onClick={onInspect}>
      <span className="run-transcript-tool-heading"><strong>{entry.toolName || 'Tool call'}</strong><EntryStatus state={entry.state} /></span>
      {presentation.target && <span className="run-transcript-target">{presentation.target}</span>}
      {entry.text && entry.text !== presentation.target && <span className="run-transcript-action">{entry.text}</span>}
      {presentation.content && <span className="run-transcript-preview">
        <span className="run-transcript-content-label">{presentation.source === 'input' ? 'Recorded input · not a confirmed file change' : presentation.format === 'diff' ? entry.state === 'running' ? 'Source diff preview' : 'Recorded source diff' : entry.state === 'error' ? 'Error output' : 'Output'}</span>
        <TranscriptCode text={presentation.content} diff={presentation.format === 'diff'} preview languageHint={presentation.target} />
      </span>}
      {truncated && <span className="run-transcript-retention">Recording truncated · expansion shows retained content only.</span>}
      {editWithoutDiff && <span className="run-transcript-retention">{entry.state === 'running' ? 'Waiting for a recorded source diff…' : 'Source diff unavailable in this recording. Patch instructions remain in recorded arguments.'}</span>}
      <span className="run-transcript-disclosure-hint"><span className="run-transcript-expand-label">{lines > 8 ? `${lines - 8} more lines · ` : ''}Expand recorded details</span><span className="run-transcript-collapse-label">Collapse details</span></span>
    </summary>
    <div className="run-transcript-tool-body">
      {presentation.content ? <div><h4>{presentation.source === 'input' ? 'Recorded input · not a confirmed file change' : presentation.format === 'diff' ? entry.state === 'running' ? 'Source diff preview' : 'Recorded source diff' : entry.state === 'error' ? 'Error output' : 'Output'}</h4><TranscriptCode text={presentation.content} diff={presentation.format === 'diff'} languageHint={presentation.target} /></div> : <p className="muted">{entry.state === 'running' ? 'Waiting for tool output…' : 'No readable output recorded.'}</p>}
      <details className="run-transcript-record"><summary>Recorded arguments &amp; raw result</summary>
        <h4>Arguments</h4><pre tabIndex={0}>{entry.input || 'No input recorded.'}</pre>
        <h4>Raw result</h4><pre tabIndex={0}>{entry.output || (entry.state === 'running' ? 'Waiting for tool output…' : 'No output recorded.')}</pre>
      </details>
    </div>
  </details>;
});

export default function RunTranscript({ run }: { run: Pick<Run, 'id' | 'conversation' | 'transcript' | 'status' | 'dialog'> }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [following, setFollowing] = useState(true);
  const structured = run.conversation !== undefined;
  const waiting = run.status === 'running' && !!run.dialog;
  const executing = run.status === 'stopping' || run.status === 'running' && !waiting;
  const activity = run.status === 'stopping' ? 'Stopping…' : waiting ? 'Waiting for your response' : run.status === 'running' ? 'Agent executing…' : run.status === 'paused' ? 'Paused' : run.status === 'needs_review' ? 'Ready for review' : `Run ${run.status.replaceAll('_', ' ')}`;

  useLayoutEffect(() => {
    if (follow.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [run.conversation, run.transcript]);

  useLayoutEffect(() => {
    if (!content.current) return;
    const observer = new ResizeObserver(() => {
      if (follow.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
    });
    observer.observe(content.current);
    return () => observer.disconnect();
  }, []);

  function jumpToLatest() {
    follow.current = true;
    setFollowing(true);
    if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }

  const inspectTool = useCallback(() => {
    follow.current = false;
    setFollowing(false);
  }, []);

  return <section className="detail-section run-transcript" aria-labelledby="live-transcript-heading" data-run-id={run.id}>
    <h3 id="live-transcript-heading">Live transcript</h3>
    <p className="muted">Persisted output, including errors and partial work. Browser closure does not stop this process. This transcript is read-only. A completed tool call is not independent verification or acceptance.</p>
    {!structured && <p className="run-transcript-legacy-note">Structured messages and tool details are unavailable for this older run. The recorded legacy log is shown below; missing details are not reconstructed.</p>}
    <div className="run-transcript-surface">
      <div className="run-transcript-toolbar">
        <span className="run-transcript-activity" role="status" aria-live="polite" aria-atomic="true">
          {executing && <span aria-hidden="true"><Spin size="small" /></span>}
          {activity}
        </span>
        <span className="muted" role="status">{following ? 'Following latest' : 'Following paused · viewing earlier output'}</span>
        {!following && <Button onClick={jumpToLatest}>Jump to latest</Button>}
      </div>
      <div className="run-transcript-viewport" ref={viewport} role="log" aria-label="Run conversation" aria-live={following ? 'polite' : 'off'} aria-relevant="additions text" tabIndex={0} onScroll={event => {
        const target = event.currentTarget;
        const atBottom = target.scrollHeight - target.clientHeight - target.scrollTop <= 4;
        follow.current = atBottom;
        setFollowing(atBottom);
      }}>
        <div className="run-transcript-entries" ref={content}>
        {structured ? run.conversation!.length ? run.conversation!.map(entry => entry.kind === 'tool' ? <ToolEntry key={entry.id} entry={entry} onInspect={inspectTool} /> : <article key={entry.id} className={`run-transcript-message run-transcript-message-${entry.kind}${entry.state === 'error' ? ' run-transcript-error' : ''}`} data-entry-id={entry.id} data-state={entry.state}>
          <header><strong>{entry.kind === 'agent' ? 'OMP agent' : entry.kind === 'user' ? 'User' : 'System'}</strong>{entry.kind === 'agent' && entry.state === 'running' ? <span className="run-transcript-streaming">Streaming</span> : <EntryStatus state={entry.state} />}</header>
          {entry.kind === 'agent' ? <div className="run-transcript-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={defaultUrlTransform} components={markdownComponents}>{entry.text || (entry.state === 'running' ? 'Waiting for agent output…' : '(No text recorded)')}</Markdown></div> : <p className="run-transcript-plain">{entry.text || '(No text recorded)'}</p>}
        </article>) : <p className="run-transcript-empty">{run.status === 'running' ? 'Waiting for recorded output…' : 'No conversation entries recorded.'}</p> : <pre className="run-transcript-legacy">{run.transcript || 'No legacy output recorded.'}</pre>}
        </div>
      </div>
    </div>
  </section>;
}
