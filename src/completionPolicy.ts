import type { CompletionPolicy, VerificationRecipe } from '../server/contracts';

export interface CompletionDraft {
  mode: 'human' | 'autonomous';
  argv: string;
  files: string;
  timeoutSeconds: number | null;
  reviewerModel: string;
  maxCorrections: number | null;
  maxRecoveries: number | null;
}

const PLAIN_ARGUMENT = /^[\w@%+=:,./-]+$/u;

/** Shows argv as a typed command, falling back to a JSON array when an argument needs quoting. */
export function commandText(argv: string[]): string {
  return argv.every(arg => PLAIN_ARGUMENT.test(arg)) ? argv.join(' ') : JSON.stringify(argv);
}

/** Splits a typed command on spaces. Shell syntax is rejected because the command never runs through a shell. */
export function parseCommand(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Enter a check command, for example npm test.');
  if (trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed); } catch { throw new Error('A command starting with [ must be a valid JSON array of strings.'); }
  }
  const argv = trimmed.split(/\s+/u);
  if (argv.some(arg => !PLAIN_ARGUMENT.test(arg))) throw new Error('Use a plain command like npm run test. Quotes, &&, pipes and other shell syntax do not work here; put several steps in one script or Makefile target instead.');
  return argv;
}

export function completionDraft(policy?: CompletionPolicy): CompletionDraft {
  return policy?.mode === 'autonomous'
    ? { mode: policy.mode, argv: commandText(policy.verification.argv), files: policy.verification.files.join('\n'), timeoutSeconds: policy.verification.timeoutSeconds, reviewerModel: policy.reviewerModel, maxCorrections: policy.maxCorrections, maxRecoveries: policy.maxRecoveries }
    : { mode: 'human', argv: '', files: '', timeoutSeconds: 300, reviewerModel: '', maxCorrections: 2, maxRecoveries: 1 };
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code >= 127 && code <= 159) return true;
  }
  return false;
}

export function commissionedRecipe(draft: CompletionDraft): VerificationRecipe {
  const argv = parseCommand(draft.argv);
  if (!Array.isArray(argv) || !argv.length || argv.length > 64 || argv.some(value => typeof value !== 'string' || value.length > 4096 || hasControlCharacters(value)) || !argv[0]?.trim()) throw new Error('Command argv needs 1–64 string arguments, an executable, and no control characters; each argument is limited to 4096 characters.');
  const files = draft.files.split('\n').map(file => file.trim()).filter(Boolean);
  if (!files.length || files.length > 32 || files.some(file => file.length > 1024 || file.startsWith('/') || file.includes('\\') || hasControlCharacters(file) || file.split('/').some(part => !part || part === '.' || part === '..'))) throw new Error('List 1–32 existing repository-relative recipe paths, one per line, up to 1024 characters each, without control characters or . or .. segments.');
  if (new Set(files).size !== files.length) throw new Error('Recipe file paths must not be repeated.');
  if (draft.timeoutSeconds === null || !Number.isInteger(draft.timeoutSeconds) || draft.timeoutSeconds < 1 || draft.timeoutSeconds > 1800) throw new Error('Command timeout must be a whole number from 1 to 1800 seconds.');
  const reviewerModel = draft.reviewerModel.trim();
  if (draft.reviewerModel.length > 512 || hasControlCharacters(draft.reviewerModel) || reviewerModel && !/^[^/]+\/.+$/u.test(reviewerModel)) throw new Error('Reviewer model must be an exact provider/model, up to 512 characters without control characters, or blank to use the attempt model.');
  for (const [label, value, max] of [['Correction limit', draft.maxCorrections, 2], ['Recovery limit', draft.maxRecoveries, 1]] as const) {
    if (value === null || !Number.isInteger(value) || value < 0 || value > max) throw new Error(`${label} must be a whole number from 0 to ${max}.`);
  }
  return { argv: argv as string[], files, timeoutSeconds: draft.timeoutSeconds };
}
