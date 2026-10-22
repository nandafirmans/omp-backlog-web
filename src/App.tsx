import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Alert, Button, ConfigProvider, Dropdown, Input, Skeleton, Tag, theme } from 'antd';
import { HouseIcon, GearSixIcon, BlueprintIcon, DesktopIcon, MoonIcon, SunIcon, SignOutIcon, ListIcon, XIcon, BroadcastIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { Link, useLocation } from 'react-router';
import type { Snapshot } from '../server/contracts';
import plan from '../PLAN.md?raw';
import MarkdownPreview from './MarkdownPreview';
import Workspace from './Workspace';
import type { RequestApi } from './Workspace';

interface Session { authenticated: boolean; configured: boolean; csrf: string }
const downloadUrl = `data:text/markdown;charset=utf-8,${encodeURIComponent(plan)}`;

export default function App() {
  const { pathname } = useLocation();
  const view = pathname === '/plan' ? 'plan' : pathname === '/settings' ? 'settings' : 'workspace';
  const [session, setSession] = useState<Session>();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [connection, setConnection] = useState('Connecting');
  const [error, setError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [menuPath, setMenuPath] = useState<string>();
  const csrf = useRef('');
  const refreshSequence = useRef(0);
  const [colorMode, setColorMode] = useState<'system' | 'light' | 'dark'>(() => {
    const saved = localStorage.getItem('omp-color-mode');
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  });
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const dark = colorMode === 'system' ? systemDark : colorMode === 'dark';

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('omp-color-mode', colorMode);
  }, [colorMode, dark]);

  const api: RequestApi = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const headers = new Headers(init?.headers);
    if (init?.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    if (init?.method && !['GET', 'HEAD'].includes(init.method)) headers.set('X-CSRF-Token', csrf.current);
    const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
    const result: unknown = await response.json();
    if (!response.ok) {
      if (response.status === 401) { ++refreshSequence.current; csrf.current = ''; setSession(previous => ({ authenticated: false, configured: previous?.configured ?? true, csrf: '' })); setSnapshot(undefined); }
      const message = typeof result === 'object' && result !== null && 'error' in result ? String(result.error) : `Request failed (${response.status})`;
      throw Object.assign(new Error(message), { status: response.status });
    }
    return result as T;
  }, []);

  const readSession = useCallback(async () => {
    const next = await api<Session>('/api/session');
    csrf.current = next.csrf ?? '';
    setSession(next);
    if (!next.authenticated) { ++refreshSequence.current; setSnapshot(undefined); }
    return next;
  }, [api]);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const next = await api<Snapshot>('/api/state');
    if (sequence === refreshSequence.current) setSnapshot(next);
  }, [api]);

  useEffect(() => {
    let active = true;
    async function connect() {
      try { await readSession(); }
      catch (cause) {
        if (active) { setError(cause instanceof Error ? cause.message : String(cause)); setConnection('Unavailable'); }
      }
    }
    void connect();
    return () => { active = false; };
  }, [readSession]);

  useEffect(() => {
    if (!session?.authenticated) return;
    let active = true;
    const report = (cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); };
    const events = new EventSource('/api/events');
    const update = () => { void refresh().catch(report); };
    const reconnect = () => {
      void readSession().then(current => {
        if (active && current.authenticated) { setConnection('Live'); update(); }
      }).catch(report);
    };
    events.addEventListener('open', reconnect);
    events.addEventListener('change', update);
    events.addEventListener('error', () => {
      if (!active) return;
      setConnection('Reconnecting');
      void readSession().catch(report);
    });
    const onVisible = () => { if (document.visibilityState === 'visible') reconnect(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', reconnect);
    update();
    return () => { active = false; events.close(); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', reconnect); };
  }, [session?.authenticated, readSession, refresh]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setLoggingIn(true); setError('');
    try {
      const result = await api<{ csrf: string }>('/api/login', { method: 'POST', body: JSON.stringify({ username: fields.get('username'), password: fields.get('password') }) });
      csrf.current = result.csrf;
      await readSession();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoggingIn(false); }
  }

  async function logout() {
    setError('');
    try { await api('/api/logout', { method: 'POST' }); await readSession(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  return (
    <ConfigProvider theme={{
      algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
      token: {
        colorPrimary: dark ? '#4fb6b2' : '#216e6b',
        colorInfo: dark ? '#4fb6b2' : '#216e6b',
        colorBgBase: dark ? '#151922' : '#eef1f5',
        colorBgContainer: dark ? '#1d2430' : '#f8fafc',
        colorBgElevated: dark ? '#283341' : '#f8fafc',
        colorText: dark ? '#e5eaf0' : '#243041',
        colorTextSecondary: dark ? '#9aa8b8' : '#526174',
        colorTextPlaceholder: dark ? '#9aa8b8' : '#526174',
        colorBorder: dark ? '#3b495b' : '#a3b1c2',
        colorError: dark ? '#d97878' : '#a83d45',
        colorWarning: dark ? '#d4b176' : '#805714',
        borderRadius: 0,
        fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
        fontSize: 15,
        fontSizeSM: 13,
        fontWeightStrong: 700,
        controlHeight: 38,
        motion: false,
      },
      components: { Button: { fontWeight: 600, primaryColor: dark ? '#151922' : '#f8fafc', defaultShadow: 'none', primaryShadow: 'none' } },
    }}>
      <div className="workspace">
        <a className="skip-link" href="#content">Skip to content</a>
        <div className="page">
          <header className="topbar">
            <Link className="brand" to="/"><span className="brand-mark" aria-hidden="true">ob</span><span>OMP Backlog<small>Local workspace</small></span></Link>
            <div className={`primary-navigation${menuPath === pathname ? ' is-open' : ''}`}>
              <Button className="navigation-toggle" icon={menuPath === pathname ? <XIcon size={18} aria-hidden="true" /> : <ListIcon size={18} aria-hidden="true" />} aria-expanded={menuPath === pathname} aria-controls="main-navigation" onClick={() => setMenuPath(menuPath === pathname ? undefined : pathname)}>Menu</Button>
              <nav id="main-navigation" aria-label="Main navigation">
                <Link to="/" onClick={() => setMenuPath(undefined)} aria-current={pathname === '/' ? 'page' : undefined}><HouseIcon size={18} aria-hidden="true" />Home</Link>
                {session?.authenticated && <Link to="/settings" onClick={() => setMenuPath(undefined)} aria-current={view === 'settings' ? 'page' : undefined}><GearSixIcon size={18} aria-hidden="true" />Settings</Link>}
                <Link to="/plan" onClick={() => setMenuPath(undefined)} aria-current={view === 'plan' ? 'page' : undefined}><BlueprintIcon size={18} aria-hidden="true" />Implementation plan</Link>
              </nav>
            </div>
            <div className="toolbar navbar-tools">
              <Dropdown trigger={['click']} menu={{
                selectable: true,
                selectedKeys: [colorMode],
                items: [
                  { key: 'system', icon: <DesktopIcon size={18} aria-hidden="true" />, label: 'System' },
                  { key: 'light', icon: <SunIcon size={18} aria-hidden="true" />, label: 'Light' },
                  { key: 'dark', icon: <MoonIcon size={18} aria-hidden="true" />, label: 'Dark' },
                ],
                onClick: ({ key }) => { if (key === 'system' || key === 'light' || key === 'dark') setColorMode(key); },
              }}>
                <Button className="theme-toggle" aria-label={`Color theme: ${colorMode}`} title={`Color theme: ${colorMode}`} icon={colorMode === 'system' ? <DesktopIcon size={18} aria-hidden="true" /> : colorMode === 'dark' ? <MoonIcon size={18} aria-hidden="true" /> : <SunIcon size={18} aria-hidden="true" />} />
              </Dropdown>
              {session?.authenticated && <><Tag icon={connection === 'Live' ? <BroadcastIcon size={15} aria-hidden="true" /> : <WarningCircleIcon size={15} aria-hidden="true" />} className={`connection ${connection === 'Live' ? 'connected' : 'unavailable'}`} role="status" aria-label={connection} title={connection}><span className="connection-label">{connection}</span></Tag><Button icon={<SignOutIcon size={18} aria-hidden="true" />} onClick={() => void logout()}>Log out</Button></>}
            </div>
          </header>
          <main id="content" tabIndex={-1} className={session?.authenticated && (pathname === '/' || pathname === '/projects/new') ? 'home-main' : undefined}>
            {error && <Alert type="error" title={error} closable={{ onClose: () => setError('') }} role="alert" />}
            {view === 'plan' ? <section className="plan-view" aria-labelledby="plan-heading">
              <div className="section-heading"><h1 id="plan-heading">Implementation plan</h1><Button href={downloadUrl} download="PLAN.md">Download Markdown</Button></div>
              <p className="plan-description">Architecture, security, ticket format, permissions, lifecycle, and acceptance criteria.</p><MarkdownPreview source={plan} />
            </section>
              : !session ? <section className="panel"><h1>Connecting to workspace</h1>{error ? <><p>Unable to reach local backend.</p><Button onClick={() => { setError(''); void readSession().catch(cause => setError(String(cause))); }}>Reconnect</Button></> : <Skeleton active={false} title={false} paragraph={{ rows: 3 }} />}</section>
              : !session.authenticated ? <section className="login-view">
                <div className="login-intro"><code className="terminal-prompt">$ omp backlog</code><h1>Agent work.<br />Under your control.</h1><p className="lead">Write requirements. Approve revisions. Review evidence.</p></div>
                {!session.configured ? <div className="panel setup-panel"><h2>Create owner account</h2><p>Registration is terminal-only. Run this command from the application directory, then return here.</p><pre><code>bun server/setup.ts</code></pre><Button onClick={() => { void readSession().catch(cause => setError(String(cause))); }}>Check setup again</Button></div>
                  : <form className="panel login-form" onSubmit={event => void login(event)}><h2>Sign in</h2><label htmlFor="username">Username<Input id="username" name="username" autoComplete="username" required autoFocus /></label><label htmlFor="password">Password<Input.Password id="password" name="password" autoComplete="current-password" required /></label><Button type="primary" htmlType="submit" disabled={loggingIn}>{loggingIn ? 'Signing in…' : 'Sign in'}</Button><p className="muted">One owner. Loopback access. No public registration.</p></form>}
              </section>
              : snapshot ? <Workspace snapshot={snapshot} api={api} refresh={refresh} onError={setError} /> : <div role="status" aria-label="Loading repositories"><Skeleton active={false} paragraph={{ rows: 6 }} /></div>}
          </main>
        </div>
      </div>
    </ConfigProvider>
  );
}
