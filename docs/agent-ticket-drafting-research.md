# Agent-assisted ticket creation

Research date: 2026-10-24. Original findings below describe the pre-implementation baseline. Implementation and isolated verification now exist; see [current behavior and evidence](current-agent-workflow.md#agent-assisted-creation) and [operator instructions](../README.md#create-with-agent-optional). This historical research is not the current feature-status source.

## Decision

Add an optional **Create with agent** conversation to the existing new-ticket panel. Reuse its Markdown editor, completion sources, attachment validation and final editable ticket. Use installed OMP over the existing JSONL RPC transport; do not add an AI SDK, another scheduler, or another ticket format.

Drafting is not implementation permission. Keep generated Markdown and draft uploads outside `.omp-backlog/tickets` until explicit **Create ticket**. The implementation ticket is [T001](tickets/T001-agent-assisted-ticket-creation.md), deliberately outside the watched queue.

## What already exists

- New-ticket and existing-ticket editing share `TicketEditor`; Markdown/Preview, unsaved-navigation protection and staged new-ticket uploads already exist. [L1]
- CodeMirror already completes repository `@file` references and `/skill:NAME`; reuse the same completion interface in the prompt instead of building another search mechanism. Quoted paths with spaces are supported. [L2–L3]
- Attachments have filename/type restrictions, 10 MiB/file, 50 MiB/ticket and 100-file limits. Descriptive Markdown references are required for execution. New-ticket uploads have retry/conflict recovery. Upload support does not establish that the model can understand every supported document format. [L1, L4]
- Execution already launches `RpcProcess`, negotiates protocol v2, streams assistant text, and passes images as base64 content. It rejects oversized inbound prompts; inbound frames are not chunked. Reuse transport, not execution's goal/scheduler lifecycle. [L5–L6]
- Current model setting is a global free-form execution setting. There is no drafting conversation or thinking-level selector. Draft selections must not silently change execution settings. [L1, L7]
- **Automatic accepts valid Draft tickets.** Saving a ticket is not a safe temporary storage mechanism for an agent conversation. Existing admission also checks global/project pause, dependencies, workspace safety and the global execution slot. [L8]

## OMP capability fit

Official RPC docs at release commit `45c35e40c46166dc726ccc52f5d27f40f2449f99` document these commands. This pinned release is a research reference, not an assertion that every installed/future OMP binary has identical capabilities. Negotiate and fail visibly when required capabilities are unavailable. [S1]

- Model discovery: `get_available_models` waits for background discovery. Selection: `set_model({ provider, modelId })`; a missing model fails rather than selecting an arbitrary fallback.
- Thinking discovery: `get_available_thinking_levels` returns `off` plus the current model's supported efforts. Refresh after changing model. `set_thinking_level({ level })` accepts the documented enum; do not hard-code every level as available for every model. Discovery excludes `inherit` and session-only `auto`.
- Send: `prompt({ message, images? })`. Images are `ImageContent`; ordinary document uploads are not a generic attachment argument. Host must supply safely prepared context or explain that a document cannot be read.
- Stream assistant events, then observe `prompt_result` and settlement. An accepted prompt response alone does not establish provider success. Preserve partial output on errors/cancellation.
- `abort`, session state and session statistics support bounded interaction and cancellation. Do not create a goal or register execution's result/evidence tools for drafting.
- CLI `@file` arguments are rejected in RPC mode. Browser mentions therefore need host-owned resolution; typing an `@path` is not sufficient to transmit its bytes.

## Proposed user flow

1. **New ticket → Create with agent**; manual Markdown creation/import remains available.
2. Composer offers prompt text, model selector, model-supported thinking selector, upload/paste controls, `@` repository completion and `/skill:` completion.
3. Before sending, show which files/skills/uploads are included. Resolve only selected context through authenticated, bounded host reads. Never pass arbitrary server paths or credential contents.
4. Agent asks clarification in ordinary conversation or proposes ticket Markdown. Follow-up prompts can refine it; model/thinking changes apply to subsequent turns, with their effective values visible. Block changes while a turn is active rather than race control commands.
5. **Use draft** transfers proposed Markdown and retained attachment references into the existing Markdown/Preview editor. Do not overwrite unsaved human edits without confirmation.
6. Human edits title, ID, dependencies, request and `Done when:` criteria, then explicitly creates the ticket. Check ID conflicts through existing validation; no ID-allocation subsystem is needed.
7. In Automatic mode, warn before creation that a valid ticket may execute under standing permission. Cancel leaves conversation, editor and uploads unchanged. Approved-only and Paused retain their current behavior.

Draft context requiring server storage belongs in a private authenticated draft namespace, not ticket attachments or public URLs. Keep only what active conversations require; bounded owned-process and temporary-upload cleanup must not touch unrelated files. Do not promise reload-resumable chat unless it is actually implemented. Existing tab-local draft semantics are sufficient if clearly disclosed.

## Safe drafting, not a prompt-only promise

A normal execution agent can write files and run commands. Telling it to “only draft a ticket” is not a capability restriction.

`--no-tools` disables built-in tools, but custom tools, extensions, plugins and host tools are separate surfaces. Official docs describe custom tool discovery and executable factories; extensions can register tools. Therefore `--no-tools` alone must not be described as a read-only sandbox. [S2–S4]

Proposed launch starts from `--mode rpc`, `--no-tools`, `--no-extensions`, `--no-skills`, `--no-rules`, `--no-pty`, and a fresh private session directory. **Before adopting this recipe, inspect and verify the installed version's custom-tool/plugin/provider/config discovery paths and explicitly disable all executable discovery surfaces.** Those switches alone have not been demonstrated here to disable every discovery source. Fail closed if the implementation cannot establish the required capability restriction.

The minimum safe context mechanism is host-prepared text plus supported images: no model filesystem tools, host tools or host URI access. Resolve selected repository files and installed skill bodies using bounded host code with path/symlink/secret checks; skill contents are guidance for drafting, not authority to execute skill scripts. Resolve inline `/skill:` mentions explicitly because automatic skill loading is disabled. If a skill requires executable actions, report that limitation rather than running them.

Use a drafting-specific RPC command allowlist; never expose arbitrary RPC, `bash`, export paths, login/logout, goal commands, settings changes or ticket mutations to browser-supplied command names. Keep configured provider authentication inside OMP; do not return credentials or private configuration to the browser. Authenticated model discovery may return only presentation metadata necessary for selection. [S1]

This is capability reduction, not an OS sandbox. OMP still runs with backend OS-user permissions. Repository content, skills, uploads and generated Markdown remain untrusted; validate generated tickets through existing parser and attachment rules. [L4, L9]

## Upload and context behavior

- Reuse existing allowed uploads and limits; distinguish a retained ticket reference from model-readable content.
- Send supported images using RPC images only when the selected model supports them. For text, use bounded decoding and clearly delimited source context.
- PDF/Office files require a proven installed reader/extractor path before claiming the agent read them. Do not assume the current upload allowlist means extraction exists. If unavailable, keep the attachment, explain the limitation and ask for readable text or supported images; never fabricate a summary.
- Show over-limit and unsupported-model/content errors before sending. Include accumulated conversation/context in frame budgeting; protocol v2 only chunks outbound OMP frames, not inbound commands. [L4–L6, S1]
- Files omitted by completion security must also be rejected by direct context-resolution requests. Completion filtering is not an authorization check. Bound number/bytes of contexts, reject traversal/absolute paths and symlinks, and exclude credentials/private app data. [L3]

## Required risk mitigations

These are implementation requirements, not runtime protections delivered by this research.

- **Executable discovery:** fixed server-owned launch profile; disable discovery before modules load, avoid repository launch context if it can load project code, and prohibit arbitrary browser RPC/launch options. Disable goal continuation, retry and cache warming. Unexpected tool/URI/UI requests terminate only the owned draft child. Verify with synthetic executable-discovery sentinel fixtures; absence of exposed tools after startup is insufficient because discovery itself may execute code.
- **Slash-command dispatch:** wrap user text in a host-owned drafting prompt rather than forwarding it as a top-level OMP command. Test leading slash input separately from ordinary prompt injection; skill mentions remain host-prepared context.
- **Unreadable references:** expose per-reference preparation state and partial-extraction disclosure. Block unresolved selected context; allow explicit replacement or exclusion from model context while retaining clearly marked reference-only attachments. Revalidate after model changes. Host records what it supplied, not whether the model understood it.
- **Premature execution:** draft endpoints cannot persist tickets or approvals. Final assisted creation rechecks current project mode and the exact reviewed Markdown/attachment set. Automatic confirmation must become stale when either changes. Validate and stage the complete payload outside watched storage, then publish without any eligible intermediate state. In particular, a ticket without attachment links must not become runnable while user-selected uploads are still pending. This is a required publication invariant, not a claim that existing separate POST/upload calls provide it.
- **Verification gap:** feature completion requires an authorized live-provider browser journey as well as capability, error-path and execution-mode checks. Protocol fixtures alone cannot close that gap. Unavailable provider access or unenforceable capability restrictions mean blocked delivery, not completion.

Keep manual creation/import available. Do not change project permission modes, add a second scheduler, or weaken existing admission gates to implement these protections.

## Verification required for implementation

Real browser journeys must cover model/thinking changes, clarification and follow-up drafting, file/skill mentions, image/text uploads, unsupported document disclosure, cancellation/provider failure, handoff to both editor modes, unsaved-edit protection, upload retry and ID conflict. Use disposable repositories/private data. Verify no ticket or implementation side effect before explicit creation, including Automatic mode. Independently prove Paused, Approved-only and Automatic create behavior. Protocol fixtures prove protocol handling, not live-provider behavior; report live-provider availability separately.

Research verification: inspected application source and pinned official OMP docs. No app launch, provider request, auth/config read, execution-setting change, queued ticket, lint, build or test run. Importable ticket receives a parser smoke check separately.

## Sources

Local sources describe inspected code, not independently exercised behavior:

- **L1:** [Ticket editor](../src/Workspace.tsx), `TicketEditor`, lines 125–345; execution settings around 401–405.
- **L2:** [Markdown editor](../src/MarkdownEditor.tsx), completion source and paste integration, lines 106–138 and 172–210; [mention grammar](../src/mentions.ts).
- **L3:** [Completion discovery](../server/completions.ts), repository/skill search and filtering.
- **L4:** [Client attachments](../src/attachments.ts); [ticket parser/storage](../server/tickets.ts), lines 8–12, 45–118, 193–213 and 244–262.
- **L5:** [RPC transport](../server/rpc.ts), `RpcProcess` and frame negotiation.
- **L6:** [Execution launch](../server/runtime.ts), lines 365–478, including image injection and inbound-frame guard.
- **L7:** [API](../server/api.ts), settings around 143–156 and ticket/completion/upload endpoints around 163–202.
- **L8:** [Admission](../server/runtime.ts), `eligible`, lines 120–130; scheduler cycle around 571–614.
- **L9:** [Current workflow safety](current-agent-workflow.md#safety-and-current-limits).
- **S1:** [Official OMP RPC reference](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/docs/rpc.md): startup, framing, model, thinking, prompting, yield versus settled, host tools.
- **S2:** [Official CLI reference](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/docs/cli-reference.md): tools, extensions, skills and rules switches.
- **S3:** [Official custom tools](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/docs/custom-tools.md): discovery and executable factories.
- **S4:** [Official extensions](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/docs/extensions.md): runtime and tool registration.
