import { useEffect, useState } from 'react';
import type { Components } from 'react-markdown';
import type { Heading, Root, RootContent } from 'mdast';
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
function planNavigation() {
  return (tree: Root) => {
    if (tree.children[0]?.type === 'heading' && tree.children[0].depth === 1) tree.children.shift();
    const ids = new Map<string, number>();
    const headings: { title: string; id: string }[] = [];
    for (const node of tree.children) {
      if (node.type !== 'heading') continue;
      const text = (children: Heading['children']): string => children.map(child => 'value' in child ? child.value : 'children' in child ? text(child.children) : '').join('');
      const title = text(node.children);
      const slug = title.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
      const count = ids.get(slug) ?? 0;
      ids.set(slug, count + 1);
      const id = count ? `${slug}-${count}` : slug;
      node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id } };
      if (node.depth === 2) headings.push({ title, id });
    }
    if (!headings.length) return;
    const contents: RootContent = {
      type: 'blockquote',
      data: { hName: 'nav', hProperties: { className: ['plan-contents'], 'aria-label': 'On this page' } },
      children: [
        { type: 'paragraph', children: [{ type: 'strong', children: [{ type: 'text', value: 'On this page' }] }] },
        { type: 'list', ordered: false, spread: false, children: headings.map(({ title, id }) => ({
          type: 'listItem', spread: false, children: [{ type: 'paragraph', children: [{ type: 'link', url: `#${id}`, children: [{ type: 'text', value: title }] }] }],
        })) },
      ],
    };
    tree.children.unshift(contents);
  };
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
  a({ href, children }) {
    const documentSource = !!href && !/^(?:[a-z]+:|#|\/)/i.test(href) && /\.md(?:#|$)/i.test(href);
    return <a href={href} target={documentSource ? '_blank' : undefined} rel="noreferrer">{children}{documentSource && <span className="document-link-note"> (source, new tab)</span>}</a>;
  },
};

export default function MarkdownPreview({ source }: { source: string }) {
  return (
    <article className="plan-document" aria-label="Rendered implementation plan">
      <Markdown remarkPlugins={[remarkGfm, planNavigation]} components={components} skipHtml>{source}</Markdown>
    </article>
  );
}
