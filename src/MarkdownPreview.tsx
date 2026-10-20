import { useEffect, useState } from 'react';
import type { Components } from 'react-markdown';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { theme } from 'antd';
import mermaid from 'mermaid';

let diagramSequence = 0;

function MermaidDiagram({ source }: { source: string }) {
  const [result, setResult] = useState<{ source: string; svg?: string; error?: string }>();
  const { token } = theme.useToken();

  useEffect(() => {
    let cancelled = false;
    const id = `plan-diagram-${++diagramSequence}`;
    async function render() {
      try {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
          theme: 'base',
          fontFamily: token.fontFamily,
          flowchart: { htmlLabels: false },
          themeVariables: {
            primaryColor: token.colorBgContainer, primaryTextColor: token.colorText,
            primaryBorderColor: token.colorBorder, lineColor: token.colorTextSecondary,
            secondaryColor: token.colorBgLayout, tertiaryColor: token.colorBgElevated,
          },
        });
        const { svg } = await mermaid.render(id, source);
        if (!cancelled) setResult({ source, svg });
      } catch {
        if (!cancelled) setResult({ source, error: 'Diagram could not be rendered. Source shown below.' });
      }
    }
    void render();
    return () => { cancelled = true; };
  }, [source, token.fontFamily, token.colorBgContainer, token.colorText, token.colorBorder, token.colorTextSecondary, token.colorBgLayout, token.colorBgElevated]);

  const current = result?.source === source ? result : undefined;
  return (
    <figure className="markdown-diagram">
      <figcaption>Diagram</figcaption>
      {current?.svg ? (
        // Only Mermaid's strict-mode generated SVG enters this sink, never raw Markdown HTML.
        <div className="diagram-canvas" role="img" aria-label="Plan diagram" dangerouslySetInnerHTML={{ __html: current.svg }} />
      ) : current?.error ? <p role="status">{current.error}</p> : <p role="status">Rendering diagram…</p>}
      <details>
        <summary>Diagram source</summary>
        <pre><code>{source}</code></pre>
      </details>
    </figure>
  );
}

const components: Components = {
  pre({ children }) {
    return <div className="markdown-code">{children}</div>;
  },
  code({ className, children }) {
    if (className === 'language-mermaid') {
      return <MermaidDiagram source={String(children).trim()} />;
    }
    return <code className={className}>{children}</code>;
  },
  table({ children }) {
    return <div className="markdown-table" tabIndex={0} role="region" aria-label="Scrollable table"><table>{children}</table></div>;
  },
  // Keep references clickable without sending the reader's browsing context externally.
  a({ href, children }) {
    return <a href={href} rel="noreferrer">{children}</a>;
  },
};

export default function MarkdownPreview({ source }: { source: string }) {
  return (
    <article className="plan-document" aria-label="Rendered implementation plan">
      <Markdown remarkPlugins={[remarkGfm]} components={components} skipHtml>{source}</Markdown>
    </article>
  );
}
