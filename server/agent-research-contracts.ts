export interface ResearchReference {
  id: string;
  kind: 'repository' | 'ticket' | 'external';
  title: string;
  location: string;
  revision?: string;
  /** SHA-256 of sanitized UTF-8 text supplied to the model, never of undisclosed raw bytes. */
  contentHash?: string;
  retrievedAt: number;
  summary: string;
  /** Verified attests host retrieval, not the correctness of claims in the source. */
  status: 'verified' | 'inferred' | 'unavailable';
}

export interface ResearchResult {
  reference: ResearchReference;
  content: string;
}
