# Agent chat runtime evidence

- The installed executable reports `omp/18.20.0`; `omp --help` describes RPC mode, `--no-tools`, `--no-extensions`, `--no-skills`, `--no-rules`, `--no-lsp`, and session isolation flags. This is local version/help evidence, not a provider inference test.
- [Upstream RPC reference](https://github.com/can1357/oh-my-pi/blob/main/docs/rpc.md) specifies protocol v2 negotiation, model and thinking discovery, `set_model`, `prompt` image inputs, delta events, `abort`, command discovery, and host-tool callbacks. `prompt` admission is not completion; `prompt_result` and settled state are separate.
- [Upstream skill documentation](https://github.com/can1357/oh-my-pi/blob/main/docs/skills.md) describes startup discovery, `skills.customDirectories`, `skills.enableSkillCommands`, and native `/skill:name` expansion. Only isolated, host-authorized `SKILL.md` copies are staged; scripts and other skill files are not copied. Skill instructions do not authorize changes or execution.
- Project exploration is limited to host-provided bounded file discovery and sanitized repository reads. Shell, writes, browser, extensions and native built-in tools are unavailable. This reduces capabilities but is not an OS sandbox. Model discovery and frozen ticket generation remain isolated from workspace skills and tools.
- Protocol fixtures are not provider proof. The integrated implementation was separately exercised against installed OMP 18.20.0 and the live `openai-codex/gpt-6.1-sol` provider, thinking `low`, using only synthetic project data. Upstream `main` remains a documentation reference, not an exact installed-version guarantee.

## Observed integration

Native startup registered the two scoped host tools, discovered 18 models and curated skill commands, and returned supported thinking levels. Actual `set_model` selected `openai-codex/gpt-6.1-sol` while preserving saved messages. A live browser chat invoked `/skill:chat-proof`; its owned native journal recorded `custom_message / skill-prompt`, name `chat-proof`. The model called `project_read` on the synthetic source, returned a complete discussion response and created no tickets. One response-level click then generated and saved held T005 through an isolated model request and the existing publication journal. Zero implementation runs; no synthetic project source changed.

Native skill bodies are read once during curated discovery. Only authorized `SKILL.md` bytes are copied; companion scripts/assets and unrestricted tools are not supplied. Skills requiring shell, writes, browser, delegation or missing companion files must report the limitation. Supported slash completion exposes discovered skill commands, not unrestricted CLI commands.

New chats use an available runtime default, or select an enumerated initial model when that default is unavailable. Saved explicit selections are restored exactly or require an explicit replacement. Model and thinking controls change the native session; they do not reset its conversation or project execution mode.

Stop cancels and stops owned native work, retains failed/partial output and permits a subsequent explicit Send to reconnect with saved history. Follow-up messages after completion or Stop are supported. In-flight provider steering and queued follow-ups are not exposed by this restricted adapter; no simulated steering control is shown. Native unrestricted plan execution is deliberately disabled: planning remains read-only conversation.

## Capability status

“Verified” identifies the exercised evidence tier, not universal provider or feature-map coverage.

| Requested capability | Status and evidence |
| --- | --- |
| One chat/composer, automatic initialization/resume/connect | Verified — actual browser, fixture and live provider |
| History, new chat, rename, archive, persistence | Verified — browser new/reopen; workspace persistence/version/archive tests |
| Streaming responses | Verified — protocol deltas and live provider |
| Model discovery, thinking levels, real model switching without history reset | Verified — installed native metadata/selection, browser picker and live selected model |
| Project `@file` autocomplete and dispatch | Verified — browser completion, prepared-context tests, scoped live project reads |
| Searchable slash/skill completion and actual skill invocation | Verified — browser Enter completion without Send; live native skill-prompt receipt |
| Supported text/file/image attachments | Verified — fixture image dispatch, browser file selection, retained authenticated downloads and publication; live-provider image interpretation implemented but unverified |
| Optional planning without implementation | Verified — conversational planning tests/browser; live discussion created no files or tickets |
| Collapsible tool activity and permission limits | Verified — browser host-tool activity and live scoped read; unavailable tool requirements are described explicitly |
| Stop and subsequent follow-up | Verified — browser cancellation excludes partial response actions; native reconnect/continuation tests |
| In-flight steering/queued follow-up | Blocked in this adapter — restricted profile does not expose these controls; ordinary follow-up and Stop remain available |
| Response eligibility, exact earlier context, one/multiple tickets | Verified — server tests, browser single/multiple, live single generation |
| Titles, description, acceptance, verification, dependencies | Verified — strict validation, dependency mapping/cycle tests and actual saved tickets |
| Essential clarification without tickets | Verified — protocol test; inline browser rendering implemented but unverified for a real provider clarification |
| Duplicate protection and accepted backend ownership | Verified — concurrent request/reload tests and actual browser closure after HTTP 202 |
| Lost outcomes, interrupted generation, partial publication and safe recovery | Verified — durable receipt/journal fault tests and backend reopen; no claim of power-loss testing |
| Automatic-mode execution hold and explicit release | Verified — eligibility/API/reconciliation tests, browser held creation and explicit revision approval; project mode unchanged |
| Composer acceptance/rejection, newer typing, pending recovery | Verified — tests plus browser delayed-request/newer-text and multiline CRLF acceptance |
| Enter, Shift+Enter, autocomplete and IME guard | Verified — browser keyboard/completion and synthetic composing event; native-device IME interaction implemented but unverified |
| Near-bottom following / Jump to latest | Verified — browser scrolling and Jump action |
| Light/dark desktop/mobile layout | Verified — Light/Tokyo Night, 1440×1000 and 390×844, conversation/results/composer inspected without horizontal overflow |
| Historical records/recovery and independent manual ticket editor | Legacy creation UI and mutation routes removed. Saved historical records remain read-only and already accepted publications retain inspection/recovery. Older completed responses support text-prefix ticket creation; absent upload bytes require reattachment instead of broken ticket links. |

Private sanitized browser proof: `/tmp/omp-chat-proof-Juy0BL/proof/result.json` and adjacent screenshots. No auth/cookie dumps or raw native sessions are included. Temporary proof needs archiving before machine cleanup.
