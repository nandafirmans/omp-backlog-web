// Browser-safe drafting data. Never include provider credentials or session paths.
export interface DraftModel { provider: string; id: string; name: string; images: boolean }
export interface DraftMessage { role: 'user' | 'assistant'; text: string; model?: string; thinking?: string }
export interface DraftContext { key: string; label: string; status: 'ready' | 'unsupported' | 'failed' | 'excluded'; detail: string }
export interface DraftSnapshot {
  id: string;
  status: 'idle' | 'busy' | 'failed' | 'stopped';
  models: DraftModel[];
  model: { provider: string; id: string } | null;
  thinking: string;
  thinkingLevels: string[];
  messages: DraftMessage[];
  error: string;
}
export interface DraftPreparation { contexts: DraftContext[]; ready: boolean }
export interface AssistedConfirmation { confirmation: string; mode: 'paused' | 'approved' | 'automatic'; expires: number }
