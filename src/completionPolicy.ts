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

export function completionDraft(policy?: CompletionPolicy): CompletionDraft {
  return policy?.mode === 'autonomous'
    ? { mode: policy.mode, argv: JSON.stringify(policy.verification.argv, null, 2), files: policy.verification.files.join('\n'), timeoutSeconds: policy.verification.timeoutSeconds, reviewerModel: policy.reviewerModel, maxCorrections: policy.maxCorrections, maxRecoveries: policy.maxRecoveries }
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
  let argv: unknown;
  try { argv = JSON.parse(draft.argv); } catch { throw new Error('Command argv must be a JSON array of strings, not a shell command.'); }
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
