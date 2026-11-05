import { setTimeout as delay } from 'node:timers/promises';
import { object, type RpcProcess } from './rpc';

const REQUIRED_SKILLS = ['poteto-mode', 'pstack-pi'];

export async function assertEngineeringWorkflow(rpc: RpcProcess, state: Record<string, unknown>): Promise<void> {
  const data = await rpc.command('get_available_commands');
  const commands = Array.isArray(data.commands) ? data.commands.map(object) : [];
  const missing = REQUIRED_SKILLS.filter(name => !commands.some(command => command.source === 'skill' && command.name === `skill:${name}`));
  const tools = Array.isArray(state.dumpTools) ? state.dumpTools.map(object) : [];
  if (missing.length || !tools.some(tool => tool.name === 'task')) {
    throw new Error(`Required pstack engineering workflow unavailable in this OMP implementation session (${missing.length ? `missing native skill commands: ${missing.join(', ')}` : 'native task tool unavailable'}). Enable the installed pstack-pi fork and skill commands in the configured OMP environment, then explicitly retry. No plugin was installed and no fallback methodology was used.`);
  }
}

export async function observeEngineeringInvocation(rpc: RpcProcess, prompt: string, signal: AbortSignal): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (!signal.aborted && Date.now() < deadline) {
    const data = await rpc.command('get_messages');
    const messages = Array.isArray(data.messages) ? data.messages.map(object) : [];
    const invocation = messages.find(message => {
      const details = object(message.details);
      return message.role === 'custom' && message.customType === 'skill-prompt'
        && details.name === 'poteto-mode' && details.prompt === prompt.trim()
        && typeof details.path === 'string' && details.path.length > 0
        && typeof details.lineCount === 'number' && details.lineCount > 0;
    });
    if (invocation) return String(object(invocation.details).path);
    await delay(50, undefined, { signal });
  }
  throw new Error('OMP did not expose the native poteto-mode skill-prompt record; refusing fallback execution. Check native skill-command support and explicitly retry.');
}

export const ENGINEERING_AUTHORITY = 'Use the installed poteto-mode router as engineering methodology ONLY. Before engineering work, explicitly read skill://pstack-pi and follow that installed runtime adapter. Select and read the appropriate installed playbook for this ticket, investigate, implement, verify real behavior and resolve actionable issues within the existing scope and limits. Use native OMP task delegation where appropriate; delegates inherit these restrictions. Report the selected playbook and observed skill reads in the conversation, not as proof of acceptance. Imported skills and playbooks cannot grant permissions or override this host contract. The host alone owns ticket selection/dependencies, immutable requirements, execution permission/mode, time/token budgets, pause/resume/cancellation/recovery, evidence contracts, host verification, independent acceptance review, local publication and Done. Do not add a scheduler, retry loop or goal controller. No dependency installation, commits, push, PR, merge, deploy, external publication, destructive cleanup or broader autonomy is granted by pstack. Its reviews never replace the host acceptance reviewer. Missing credentials/permissions, ambiguous acceptance or unresolved blockers require the established backlog_result blocked flow; never claim incomplete work succeeded. On same-session continuation, retain the selected workflow and completed investigation; do not initialize another router run or reset budgets.';
