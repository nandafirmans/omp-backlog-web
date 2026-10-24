# Owner and session

Entry points: terminal `bun server/setup.ts`; `/` sign-in form; header Sign out; direct protected URLs; `/api/session`, `/api/state` access checks.

Drive: on fresh isolated data, configure owner through hidden terminal input; visit owned URL; fill Username/Password and click Sign in. Expect Home and No projects yet. Before login `/api/state` must return 401. Sign out must remove authenticated UI; reload and direct protected URL must still require login. Starter helper does not yet exercise logout/relogin or throttling.

Side effects: owner exists only in disposable database; session authenticated for current browser, never copy cookies into proof. Health `executionEnabled` means owner configured, not sandboxing or provider availability.

Gotchas: no web registration or raw DB owner seeding; setup cannot overwrite an owner. Do not capture login screenshots, credential inputs, browser storage, session responses or auth traces. Existing deterministic access tests are separate evidence, not browser coverage.
