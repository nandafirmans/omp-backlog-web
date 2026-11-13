export interface PendingAgentTurn {
  workspaceId: string;
  key: string;
  createdAt: number;
  entries: { name: string; value: string | Blob; filename?: string }[];
}

export function pendingAgentTurn(workspaceId: string, body: FormData): PendingAgentTurn {
  return {
    workspaceId, key: crypto.randomUUID(), createdAt: Date.now(),
    entries: Array.from(body, ([name, value]) => typeof value === 'string' ? { name, value } : { name, value, filename: value.name }),
  };
}

export function pendingTurnBody(turn: PendingAgentTurn): FormData {
  const body = new FormData();
  for (const entry of turn.entries) {
    if (typeof entry.value === 'string') body.append(entry.name, entry.value);
    else body.append(entry.name, entry.value, entry.filename);
  }
  return body;
}

async function database(): Promise<IDBDatabase> {
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>();
  const request = indexedDB.open('omp-agent-pending-turns', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('turns', { keyPath: 'workspaceId' });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(new Error('Pending-turn storage is unavailable. Nothing was sent.'));
  request.onblocked = () => reject(new Error('Close older workspace tabs to open pending-turn storage. Nothing was sent.'));
  return promise;
}

export async function readPendingTurn(workspaceId: string): Promise<PendingAgentTurn | undefined> {
  const db = await database();
  try {
    const { promise, resolve, reject } = Promise.withResolvers<PendingAgentTurn | undefined>();
    const request = db.transaction('turns').objectStore('turns').get(workspaceId);
    request.onsuccess = () => resolve(request.result as PendingAgentTurn | undefined);
    request.onerror = () => reject(new Error('Cannot read pending Send. Reconciliation is required before sending.'));
    return await promise;
  } finally { db.close(); }
}

export async function storePendingTurn(turn: PendingAgentTurn): Promise<void> {
  const db = await database();
  try {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const transaction = db.transaction('turns', 'readwrite');
    // add, not put: another tab must reconcile its existing request first.
    transaction.objectStore('turns').add(turn);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new Error('Cannot preserve this Send, or another tab has a pending Send. Check pending state before sending. Nothing was sent.'));
    transaction.onerror = () => undefined;
    await promise;
  } finally { db.close(); }
}

export async function clearPendingTurn(turn: PendingAgentTurn): Promise<void> {
  const db = await database();
  try {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const transaction = db.transaction('turns', 'readwrite');
    const store = transaction.objectStore('turns');
    const request = store.get(turn.workspaceId);
    request.onsuccess = () => {
      const current = request.result as PendingAgentTurn | undefined;
      if (current?.key === turn.key) store.delete(turn.workspaceId);
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new Error('Accepted Send was recovered, but pending storage could not be cleared. Check its state again.'));
    transaction.onerror = () => undefined;
    await promise;
  } finally { db.close(); }
}
