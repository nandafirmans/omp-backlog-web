import type { Lifecycle, Run } from '../server/contracts';

export const lifecycleLabels: Record<Lifecycle['phase'], string> = {
  implementing: 'Implementing', verifying: 'Host verification', reviewing: 'Independent review', correcting: 'Correcting', recovering: 'Recovering', publishing: 'Local publication', complete: 'Complete', assistance: 'Needs assistance',
};

export function lifecycleOwnsCompletion(run?: Pick<Run, 'lifecycle'>): boolean {
  return !!run?.lifecycle && run.lifecycle.phase !== 'assistance' && run.lifecycle.phase !== 'complete';
}
