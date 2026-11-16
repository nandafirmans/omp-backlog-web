import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Alert, Breadcrumb, Button, ConfigProvider, Dropdown, Grid, Input, Skeleton, Tag, theme } from 'antd';
import { PaletteIcon, SlidersIcon, GearSixIcon, CheckIcon, DesktopIcon, SignOutIcon, BroadcastIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { Link, useLocation, useParams } from 'react-router';
import type { Snapshot } from '../server/contracts';
import plan from '../PLAN.md?raw';
import MarkdownPreview from './MarkdownPreview';
import Workspace from './Workspace';
import type { RequestApi } from './Workspace';
import { isThemeMode, themeModes, themes } from './themes';
import type { ThemeMode } from './themes';

interface Session { authenticated: boolean; configured: boolean; csrf: string }
const downloadUrl = `data:text/markdown;charset=utf-8,${encodeURIComponent(plan)}`;

export default function App() {
  const { pathname } = useLocation();
  const { repoId, ticketId, runId } = useParams();
  const currentLocation = useRef<HTMLSpanElement>(null);
  const screens = Grid.useBreakpoint();
  const view = pathname === '/plan' ? 'plan' : pathname === '/settings' ? 'settings' : 'workspace';
  const [session, setSession] = useState<Session>();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [connection, setConnection] = useState('Connecting');
  const [error, setError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const csrf = useRef('');
  const refreshSequence = useRef(0);
  const [colorMode, setColorMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('omp-color-mode');
    return isThemeMode(saved) ? saved : 'system';
  });
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const resolvedTheme = colorMode === 'system' ? (systemDark ? 'dark' : 'light') : colorMode;
  const palette = themes[resolvedTheme];
  const dark = resolvedTheme !== 'light';
  const themeLabel = colorMode === 'system' ? 'System' : palette.label;

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.style.colorScheme = dark ? 'dark' : 'light';
    for (const [name, value] of Object.entries(palette)) {
      if (name !== 'label') root.style.setProperty(`--${['elevated', 'inset', 'raised'].includes(name) ? 'surface-' : ''}${name}`, value);
    }
    root.style.setProperty('--accent-soft', 'color-mix(in srgb, var(--accent) 14%, var(--surface))');
    localStorage.setItem('omp-color-mode', colorMode);
  }, [colorMode, resolvedTheme, palette, dark]);

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

  const run = snapshot?.runs.find(item => item.id === runId);
  const project = snapshot?.repos.find(item => item.id === (repoId ?? run?.repoId));
  const projectPath = project ? `/projects/${encodeURIComponent(project.id)}` : undefined;
  const trail: { title: string; to?: string }[] = [{ title: 'Projects', to: '/' }];
  if (project) trail.push({ title: project.name, to: projectPath });
  if (pathname === '/settings') trail.push({ title: 'Settings' });
  else if (pathname === '/plan') trail.push({ title: 'Implementation plan' });
  else if (pathname === '/projects/new') trail.push({ title: 'Add project' });
  else if (pathname.endsWith('/tickets/new/agent')) trail.push({ title: 'Create with agent' });
  else if (pathname.endsWith('/tickets/new')) trail.push({ title: 'New ticket' });
  else if (ticketId) trail.push({ title: ticketId });
  else if (runId) {
    if (run && projectPath) trail.push({ title: run.ticketId, to: `${projectPath}/tickets/${encodeURIComponent(run.ticketId)}` });
    trail.push({ title: 'Run details' });
  } else if (repoId && !project) trail.push({ title: 'Project unavailable' });
  else if (pathname !== '/' && !project) trail.push({ title: 'Page not found' });

  useEffect(() => {
    const navigation = currentLocation.current?.closest('nav');
    if (navigation && screens.md !== false) navigation.scrollLeft = navigation.scrollWidth;
  }, [pathname, project?.name, session?.authenticated, screens.md]);

  return (
    <ConfigProvider theme={{
      algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
      token: {
        colorPrimary: palette.accent,
        colorInfo: palette.accent,
        colorBgBase: palette.surface,
        colorBgContainer: palette.elevated,
        colorBgElevated: palette.raised,
        colorText: palette.text,
        colorTextSecondary: palette.muted,
        colorTextPlaceholder: palette.muted,
        colorBorder: palette.line,
        colorError: palette.danger,
        colorWarning: palette.warning,
        borderRadius: 0,
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 13,
        ...(screens.md === false ? { controlHeight: 44 } : {}),
        fontWeightStrong: 700,
        motion: false,
      },
      components: { Tooltip: { colorBgSpotlight: palette.raised, colorTextLightSolid: palette.text }, Button: { fontWeight: 400, primaryColor: dark ? palette.surface : palette.elevated, defaultShadow: 'none', primaryShadow: 'none' } },
    }}>
      <div className="workspace">
        <a className="skip-link" href="#content">Skip to content</a>
        <div className="page">
          <header className="topbar">
            <Link className="brand" to="/" aria-label="OMP Backlog projects"><span className="brand-mark" aria-hidden="true">ob</span><span className="brand-name">OMP Backlog</span></Link>
            {session?.authenticated && (screens.md === false
              ? <nav className="page-breadcrumb navbar-breadcrumb navbar-breadcrumb-compact" aria-label="Page location">
                  {trail.length > 1 && <Dropdown trigger={['click']} menu={{ items: trail.slice(0, -1).filter(item => item.to).map(item => ({ key: item.to!, label: <Link className="location-ancestor-link" to={item.to!}>{item.title}</Link> })) }}>
                    <Button type="text" aria-label="Page ancestors">…</Button>
                  </Dropdown>}
                  <span ref={currentLocation} aria-current="page" title={trail.at(-1)!.title}>{trail.at(-1)!.title}</span>
                </nav>
              : <Breadcrumb className="page-breadcrumb navbar-breadcrumb" aria-label="Page location" items={trail.map((item, index) => ({
                  title: index === trail.length - 1 ? <span ref={currentLocation} aria-current="page" title={item.title}>{item.title}</span> : item.to ? <Link to={item.to} title={item.title}>{item.title}</Link> : item.title,
                }))} />)}
            <div className="toolbar navbar-tools">
              {session?.authenticated && <nav className="primary-navigation" aria-label="Workspace navigation"><Link to="/settings" aria-label="Settings" title="Settings" aria-current={view === 'settings' ? 'page' : undefined}><GearSixIcon size={18} aria-hidden="true" /></Link></nav>}
              {session?.authenticated && <><Tag icon={connection === 'Live' ? <BroadcastIcon size={15} aria-hidden="true" /> : <WarningCircleIcon size={15} aria-hidden="true" />} className={`connection ${connection === 'Live' ? 'connected' : 'unavailable'}`} role="status" aria-label={connection} title={connection} /><Button aria-label="Log out" title="Log out" icon={<SignOutIcon size={18} aria-hidden="true" />} onClick={() => void logout()} /></>}
            </div>
          </header>
          <main id="content" tabIndex={-1} className={session?.authenticated ? (pathname === '/' || pathname === '/projects/new' ? 'home-main' : pathname.endsWith('/tickets/new/agent') ? 'drafting-main' : pathname.startsWith('/projects/') ? 'workspace-main' : undefined) : undefined}>
            {error && <Alert type="error" title={error} closable={{ onClose: () => setError('') }} role="alert" />}
            {session?.authenticated && view === 'settings' && <><h1>Settings</h1><nav className="settings-navigation" aria-label="Settings sections"><a href="#appearance-heading"><PaletteIcon size={16} aria-hidden="true" />Appearance</a><a href="#execution-settings"><SlidersIcon size={16} aria-hidden="true" />Execution</a></nav></>}
            {session?.authenticated && view === 'settings' && <section className="panel appearance-settings" aria-labelledby="appearance-heading">
              <h2 id="appearance-heading" className="icon-heading"><PaletteIcon size={16} aria-hidden="true" />Appearance</h2>
              <p className="muted">Theme for this browser. Applies immediately.</p>
              <Dropdown trigger={['click']} menu={{
                selectable: true,
                selectedKeys: [colorMode],
                items: themeModes.map(mode => ({
                  key: mode,
                  icon: mode === colorMode ? <CheckIcon size={18} aria-hidden="true" /> : mode === 'system' ? <DesktopIcon size={18} aria-hidden="true" /> : <span aria-hidden="true" style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: themes[mode].accent }} />,
                  label: mode === 'system' ? 'System' : themes[mode].label,
                })),
                onClick: ({ key }) => { if (isThemeMode(key)) setColorMode(key); },
              }}>
                <Button className="theme-toggle" aria-label={`Color theme: ${themeLabel}`} title={colorMode === 'system' ? `System: ${palette.label}` : themeLabel} icon={<span className="theme-swatch" aria-hidden="true" style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: palette.accent }} />}>{themeLabel}</Button>
              </Dropdown>
            </section>}
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
