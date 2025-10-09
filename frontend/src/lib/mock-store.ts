type LedgerEntry = {
  id: string;
  user_id: string;
  delta: number;
  reason: string;
  created_at: string;
};

type JobEntry = {
  id: string;
  user_id: string;
  prompt: string;
  status: string;
  video_url: string | null;
  credit_cost: number;
  provider_job_id: string | null;
  created_at: string;
};

type MockStore = {
  ledger: LedgerEntry[];
  jobs: JobEntry[];
};

declare global {
  var __mockStore: MockStore | undefined;
}

function initStore(): MockStore {
  return {
    ledger: [],
    jobs: [],
  };
}

export function getMockStore(): MockStore {
  if (!globalThis.__mockStore) {
    globalThis.__mockStore = initStore();
  }
  return globalThis.__mockStore;
}

export function sumLedgerForUser(userId: string) {
  const store = getMockStore();
  return store.ledger
    .filter((entry) => entry.user_id === userId)
    .reduce((acc, entry) => acc + entry.delta, 0);
}

export function ledgerForUser(userId: string) {
  const store = getMockStore();
  return store.ledger.filter((entry) => entry.user_id === userId);
}

export function jobsForUser(userId: string) {
  const store = getMockStore();
  return store.jobs.filter((entry) => entry.user_id === userId);
}

export function upsertJob(job: JobEntry) {
  const store = getMockStore();
  const index = store.jobs.findIndex((existing) => existing.id === job.id);
  if (index >= 0) {
    store.jobs[index] = job;
  } else {
    store.jobs.push(job);
  }
}

export function pushLedger(entry: LedgerEntry) {
  const store = getMockStore();
  store.ledger.push(entry);
}

export function getJobById(id: string) {
  const store = getMockStore();
  return store.jobs.find((job) => job.id === id) ?? null;
}

export function resetMockStore() {
  globalThis.__mockStore = initStore();
}
