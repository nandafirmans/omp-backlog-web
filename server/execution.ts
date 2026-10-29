import type { ExecutionOverrides, Run, RunConfiguration, Settings, Ticket } from './contracts';
import { THINKING_LEVELS } from './contracts';
import { HttpError } from './tickets';
import { object } from './rpc';

export function parseExecutionOverrides(value: unknown): ExecutionOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Provide ticket execution settings');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['model', 'thinking', 'tokenBudget'].includes(key))) throw new HttpError(400, 'Unknown ticket execution setting');
  const result: ExecutionOverrides = {};
  if (input.model !== undefined) {
    if (typeof input.model !== 'string' || input.model.length > 512) throw new HttpError(400, 'Invalid ticket model');
    if ((input.model !== '' && !/^[^/]+\/.+$/u.test(input.model)) || /\p{Cc}/u.test(input.model)) throw new HttpError(400, 'Choose an exact provider/model or OMP default');
    result.model = input.model;
  }
  if (input.thinking !== undefined) {
    if (typeof input.thinking !== 'string' || input.thinking !== '' && !THINKING_LEVELS.some(level => level === input.thinking)) throw new HttpError(400, 'Invalid ticket thinking level');
    result.thinking = input.thinking;
  }
  if (input.tokenBudget !== undefined) {
    if (input.tokenBudget !== null && (typeof input.tokenBudget !== 'number' || !Number.isInteger(input.tokenBudget) || input.tokenBudget < 1 || input.tokenBudget > 10000000)) throw new HttpError(400, 'Token budget must be 1–10,000,000 or null for no cumulative limit');
    result.tokenBudget = input.tokenBudget;
  }
  return result;
}

export function resolveRunConfiguration(settings: Settings, ticket: Pick<Ticket, 'execution'>): RunConfiguration {
  return { model: ticket.execution?.model ?? settings.model, thinking: ticket.execution?.thinking ?? (ticket.execution?.model === undefined ? settings.thinking ?? '' : ''), tokenBudget: ticket.execution?.tokenBudget === undefined ? settings.tokenBudget : ticket.execution.tokenBudget, timeLimitMinutes: settings.timeLimitMinutes };
}

/** Retain only bounded telemetry, never get_state's prompts, tools or provider/session objects. */
export function sampleRunState(run: Pick<Run, 'progress'>, state: Record<string, unknown>) {
  if (!run.progress) return;
  const model = object(state.model);
  if (typeof model.provider === 'string' && typeof model.id === 'string') run.progress.model = `${model.provider}/${model.id}`.slice(0, 512);
  if (typeof state.thinkingLevel === 'string' && THINKING_LEVELS.some(level => level === state.thinkingLevel)) run.progress.thinking = state.thinkingLevel;
  const context = object(state.contextUsage);
  if (typeof context.tokens === 'number' && Number.isFinite(context.tokens) && context.tokens >= 0 && typeof context.contextWindow === 'number' && Number.isFinite(context.contextWindow) && context.contextWindow > 0) {
    run.progress.context = { tokens: context.tokens, window: context.contextWindow, sampled: Date.now(), basis: 'OMP contextUsage: current provider-context estimate, not cumulative session consumption' };
  } else delete run.progress.context;
  if (typeof state.isCompacting === 'boolean' || typeof state.autoCompactionEnabled === 'boolean') {
    run.progress.compaction = { ...run.progress.compaction, active: state.isCompacting === true, sampled: Date.now(), ...(typeof state.autoCompactionEnabled === 'boolean' ? { enabled: state.autoCompactionEnabled } : {}) };
  }
}
