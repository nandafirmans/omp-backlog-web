import { useLayoutEffect, useRef, useState } from 'react';
import { Button, Tag } from 'antd';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Run, TranscriptEntry } from '../server/contracts';
import './RunTranscript.css';

const markdownComponents: Components = {
  a: ({ href, children }) => <a href={href} rel="noreferrer">{children}</a>,
  // Agent output must not fetch remote images just because a run is opened.
  img: ({ src, alt }) => <span className="run-transcript-image">Image reference: {src ? <a href={src} rel="noreferrer">{alt || 'Open image'}</a> : alt || '(unavailable)'}</span>,
  pre: ({ children }) => <pre tabIndex={0}>{children}</pre>,
  table: ({ children }) => <div className="markdown-table" role="region" aria-label="Scrollable transcript table" tabIndex={0}><table>{children}</table></div>,
};

function EntryStatus({ state }: { state: TranscriptEntry['state'] }) {
  if (!state) return null;
  return <Tag className={`run-transcript-status run-transcript-status-${state}`}>{state === 'running' ? 'Running' : state === 'error' ? 'Error' : 'Complete'}</Tag>;
}

function ToolEntry({ entry }: { entry: TranscriptEntry }) {
  return <details className={`run-transcript-tool${entry.state === 'error' ? ' run-transcript-error' : ''}`} data-entry-id={entry.id} data-state={entry.state}>
    <summary>
      <span className="run-transcript-tool-heading"><strong>{entry.toolName || 'Tool call'}</strong><EntryStatus state={entry.state} /></span>
      {entry.text && <span className="run-transcript-action">{entry.text}</span>}
      <span className="run-transcript-disclosure-hint">Arguments &amp; result</span>
    </summary>
    <div className="run-transcript-tool-body">
      <div><h4>Input</h4><pre tabIndex={0} aria-label={`${entry.toolName || 'Tool'} input`}>{entry.input || 'No input recorded.'}</pre></div>
      <div><h4>{entry.state === 'error' ? 'Error output' : 'Output'}</h4><pre tabIndex={0} aria-label={`${entry.toolName || 'Tool'} output`}>{entry.output || (entry.state === 'running' ? 'Waiting for tool output…' : 'No output recorded.')}</pre></div>
    </div>
  </details>;
}

export default function RunTranscript({ run }: { run: Pick<Run, 'id' | 'conversation' | 'transcript' | 'status'> }) {
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [following, setFollowing] = useState(true);
  const structured = run.conversation !== undefined;

  useLayoutEffect(() => {
    if (follow.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [run.conversation, run.transcript]);

  function jumpToLatest() {
    follow.current = true;
    setFollowing(true);
    if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }

  return <section className="detail-section run-transcript" aria-labelledby="live-transcript-heading" data-run-id={run.id}>
    <h3 id="live-transcript-heading">Live transcript</h3>
    <p className="muted">Persisted output, including errors and partial work. Browser closure does not stop this process. This transcript is read-only. A completed tool call is not independent verification or acceptance.</p>
    {!structured && <p className="run-transcript-legacy-note">Structured messages and tool details are unavailable for this older run. The recorded legacy log is shown below; missing details are not reconstructed.</p>}
    <div className="run-transcript-surface">
      <div className="run-transcript-toolbar">
        <span className="muted" role="status">{following ? 'Following latest' : 'Following paused · viewing earlier output'}</span>
        {!following && <Button onClick={jumpToLatest}>Jump to latest</Button>}
      </div>
      <div className="run-transcript-viewport" ref={viewport} role="log" aria-label="Run conversation" aria-live={following ? 'polite' : 'off'} aria-relevant="additions text" tabIndex={0} onScroll={event => {
        const target = event.currentTarget;
        const atBottom = target.scrollHeight - target.clientHeight - target.scrollTop <= 4;
        follow.current = atBottom;
        setFollowing(atBottom);
      }}>
        {structured ? run.conversation!.length ? run.conversation!.map(entry => entry.kind === 'tool' ? <ToolEntry key={entry.id} entry={entry} /> : <article key={entry.id} className={`run-transcript-message run-transcript-message-${entry.kind}${entry.state === 'error' ? ' run-transcript-error' : ''}`} data-entry-id={entry.id} data-state={entry.state}>
          <header><strong>{entry.kind === 'agent' ? 'OMP agent' : entry.kind === 'user' ? 'User' : 'System'}</strong><EntryStatus state={entry.state} /></header>
          {entry.kind === 'agent' ? <div className="run-transcript-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={defaultUrlTransform} components={markdownComponents}>{entry.text || (entry.state === 'running' ? 'Waiting for agent output…' : '(No text recorded)')}</Markdown></div> : <p className="run-transcript-plain">{entry.text || '(No text recorded)'}</p>}
        </article>) : <p className="run-transcript-empty">{run.status === 'running' ? 'Waiting for recorded output…' : 'No conversation entries recorded.'}</p> : <pre className="run-transcript-legacy">{run.transcript || 'No legacy output recorded.'}</pre>}
      </div>
    </div>
    {structured && <details className="run-transcript-raw"><summary>Legacy / raw log</summary><p className="muted">Separate transport and lifecycle log; it may repeat conversation output. Only recorded content is available.</p><pre className="transcript" tabIndex={0}>{run.transcript || 'No raw log recorded.'}</pre></details>}
  </section>;
}
