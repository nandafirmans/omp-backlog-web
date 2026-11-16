import { CheckIcon, CopyIcon } from '@phosphor-icons/react';
import { Button } from 'antd';
import { isValidElement, useState, type ComponentProps, type ReactElement } from 'react';

type CodeProps = ComponentProps<'code'>;

/** Fenced code in chat: language label plus a copy action, like ChatGPT and Claude web. */
export default function ChatCodeBlock({ children }: ComponentProps<'pre'>) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const code = isValidElement(children) ? (children as ReactElement<CodeProps>) : undefined;
  const language = /language-([\w+#-]+)/.exec(code?.props.className ?? '')?.[1];
  const text = typeof code?.props.children === 'string' ? code.props.children.replace(/\n$/, '') : '';

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), 1500);
  }

  return <div className="chat-code">
    <div className="chat-code-bar">
      <span>{language ?? 'text'}</span>
      <Button type="text" size="small" icon={state === 'copied' ? <CheckIcon /> : <CopyIcon />} onClick={copy} aria-label={`Copy ${language ?? 'code'} block`}>
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
      </Button>
    </div>
    <pre>{children}</pre>
  </div>;
}
