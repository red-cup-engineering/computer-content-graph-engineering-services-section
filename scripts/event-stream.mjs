/** A FIFO admission boundary.  The caller owns validation policy and draining. */
export function createValidatedQueue({ validate = (value) => (value && typeof value === "object" ? value : null) } = {}) {
  let pending = [];
  return {
    push(value) {
      const admitted = validate(value);
      if (admitted !== null && admitted !== undefined) pending.push(admitted);
      return admitted;
    },
    drain() {
      const batch = pending;
      pending = [];
      return batch;
    },
    depth: () => pending.length,
  };
}

/**
 * An in-memory append-only log. `canonicalize` must return an independent
 * record when callers need protection from later mutation of their input.
 */
export function createAppendOnlyLog({ canonicalize = (record) => record } = {}) {
  const records = [];
  return {
    append(record) {
      const canonical = canonicalize(record);
      records.push(canonical);
      return canonical;
    },
    all: () => records.slice(),
    length: () => records.length,
  };
}

/**
 * Keep a bounded, independent FIFO history for each key. `since()` returns
 * null when the requested numbered prefix is no longer fully covered. It is
 * suitable for delta streams that publish one entry for every number; streams
 * that intentionally skip numbers must model coverage themselves.
 */
export function createKeyedNumberedHistory(capacity, { numberOf = (entry) => entry?.number } = {}) {
  const byKey = new Map();
  return {
    push(key, entry) {
      const history = byKey.get(key) ?? [];
      history.push(entry);
      while (history.length > capacity) history.shift();
      byKey.set(key, history);
    },
    since(key, afterNumber) {
      const history = byKey.get(key);
      if (!history || history.length === 0) return null;
      if (numberOf(history[0]) - 1 > afterNumber) return null;
      return history.filter((entry) => numberOf(entry) > afterNumber);
    },
    drop(key) { byKey.delete(key); },
    size(key) { return (byKey.get(key) ?? []).length; },
  };
}

/**
 * Cache a projection keyed by entry id. A domain supplies the subject list and
 * projection function; this utility supplies dirty refresh and subscriber
 * change tracking. It never serializes or transports entries.
 */
export function createIncrementalProjection({ subjectsOf, entryOf, idOf = (entry) => entry?.id, interest = null, signature = JSON.stringify }) {
  if (typeof subjectsOf !== "function") throw new TypeError("incremental-projection: subjectsOf(step) is required");
  if (typeof entryOf !== "function") throw new TypeError("incremental-projection: entryOf(id, step) is required");
  if (typeof idOf !== "function") throw new TypeError("incremental-projection: idOf(entry) must be a function");

  const cache = new Map();
  const idsBySubject = new Map();
  const subscribers = new Map();
  const frame = (type, step, entries, removed = [], acknowledged) => ({
    type, step, entries, removed, ...(acknowledged === undefined ? {} : { acknowledged }),
  });

  async function bootstrap(step) {
    cache.clear();
    idsBySubject.clear();
    for (const subject of await subjectsOf(step)) {
      const entry = await entryOf(subject, step);
      if (entry) {
        const id = idOf(entry);
        cache.set(id, entry);
        idsBySubject.set(subject, id);
      }
    }
    return frame("full", step, [...cache.values()]);
  }

  async function refresh(dirty, step) {
    const entries = [];
    const removed = [];
    for (const subject of dirty) {
      const entry = await entryOf(subject, step);
      if (entry) {
        const id = idOf(entry);
        const previousId = idsBySubject.get(subject);
        if (previousId !== undefined && previousId !== id && cache.delete(previousId)) removed.push(previousId);
        cache.set(id, entry);
        idsBySubject.set(subject, id);
        entries.push(entry);
      } else {
        const previousId = idsBySubject.get(subject);
        idsBySubject.delete(subject);
        if (previousId !== undefined && cache.delete(previousId)) removed.push(previousId);
      }
    }
    return frame("delta", step, entries, removed);
  }

  function full(step) { return frame("full", step, [...cache.values()]); }
  function visibleFor(subscriberId) {
    return [...cache].filter(([id]) => !interest || interest(id, subscriberId));
  }

  function subscribe(subscriberId) {
    const state = { lastView: new Map() };
    subscribers.set(subscriberId, state);
    return {
      id: subscriberId,
      full(step) {
        state.lastView.clear();
        const entries = visibleFor(subscriberId).map(([id, entry]) => {
          state.lastView.set(id, signature(entry));
          return entry;
        });
        return frame("full", step, entries);
      },
      delta(step, acknowledged = 0) {
        const entries = [];
        const seen = new Set();
        for (const [id, entry] of visibleFor(subscriberId)) {
          seen.add(id);
          const next = signature(entry);
          if (state.lastView.get(id) !== next) {
            state.lastView.set(id, next);
            entries.push(entry);
          }
        }
        const removed = [];
        for (const id of state.lastView.keys()) {
          if (!seen.has(id)) {
            state.lastView.delete(id);
            removed.push(id);
          }
        }
        return frame("delta", step, entries, removed, acknowledged);
      },
      drop() { subscribers.delete(subscriberId); },
    };
  }

  return { bootstrap, refresh, full, subscribe, has: (id) => cache.has(id), size: () => cache.size };
}

/**
 * Replay an ordered record stream over every integer step through `totalSteps`.
 * Empty steps are intentionally applied: autonomous domains may evolve between
 * admitted records. `onStep` receives the result of each application.
 */
export async function replayEventStream(records, { totalSteps, stepOf, valueOf = (record) => record, apply, onStep = null }) {
  if (!Number.isInteger(totalSteps) || totalSteps < 0) throw new TypeError("event-stream replay: totalSteps must be a non-negative integer");
  if (typeof stepOf !== "function" || typeof apply !== "function") throw new TypeError("event-stream replay: stepOf and apply are required");
  const byStep = new Map();
  for (const record of records) {
    const step = stepOf(record);
    if (!Number.isInteger(step) || step < 1 || step > totalSteps) {
      throw new TypeError("event-stream replay: every record step must be an integer within totalSteps");
    }
    const values = byStep.get(step) ?? [];
    values.push(valueOf(record));
    byStep.set(step, values);
  }
  let result;
  for (let step = 1; step <= totalSteps; step += 1) {
    result = await apply(step, byStep.get(step) ?? []);
    if (onStep) await onStep(step, result);
  }
  return result;
}
