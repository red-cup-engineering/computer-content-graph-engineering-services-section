/** Dependency-free primitives for an admitted event stream and its projections. */

export interface ValidatedQueue<T> {
  push(value: unknown): T | null | undefined;
  drain(): T[];
  depth(): number;
}

export function createValidatedQueue<T = Record<string, unknown>>(options?: {
  validate?: (value: unknown) => T | null | undefined;
}): ValidatedQueue<T>;

export interface AppendOnlyLog<T> {
  append(record: T): T;
  all(): T[];
  length(): number;
}

export function createAppendOnlyLog<T = unknown>(options?: {
  canonicalize?: (record: T) => T;
}): AppendOnlyLog<T>;

export interface KeyedNumberedHistory<Entry, Key = unknown> {
  push(key: Key, entry: Entry): void;
  since(key: Key, afterNumber: number): Entry[] | null;
  drop(key: Key): void;
  size(key: Key): number;
}

/**
 * A bounded history for streams that publish one entry for every numbered
 * position. `since()` returns null when its requested prefix has aged out.
 */
export function createKeyedNumberedHistory<Entry extends object, Key = unknown>(capacity: number, options?: {
  numberOf?: (entry: Entry) => number;
}): KeyedNumberedHistory<Entry, Key>;

export interface ProjectionFullFrame<E> {
  type: "full";
  step: number;
  entries: E[];
  removed: [];
}

export interface ProjectionDeltaFrame<E> {
  type: "delta";
  step: number;
  entries: E[];
  removed: string[];
  acknowledged?: number;
}

export interface ProjectionSubscriber<E, SubscriberId = unknown> {
  id: SubscriberId;
  full(step: number): ProjectionFullFrame<E>;
  delta(step: number, acknowledged?: number): ProjectionDeltaFrame<E>;
  drop(): void;
}

export interface IncrementalProjection<E, Subject = string, SubscriberId = unknown> {
  bootstrap(step: number): Promise<ProjectionFullFrame<E>>;
  refresh(dirty: Iterable<Subject>, step: number): Promise<ProjectionDeltaFrame<E>>;
  full(step: number): ProjectionFullFrame<E>;
  subscribe(subscriberId: SubscriberId): ProjectionSubscriber<E, SubscriberId>;
  has(id: string): boolean;
  size(): number;
}

export function createIncrementalProjection<E extends object, Subject = string, SubscriberId = unknown>(options: {
  subjectsOf: (step: number) => Iterable<Subject> | Promise<Iterable<Subject>>;
  entryOf: (subject: Subject, step: number) => E | null | Promise<E | null>;
  idOf?: (entry: E) => string;
  interest?: ((id: string, subscriberId: SubscriberId) => boolean) | null;
  signature?: (entry: E) => string;
}): IncrementalProjection<E, Subject, SubscriberId>;

export function replayEventStream<Record, Value = Record, Result = unknown>(records: Iterable<Record>, options: {
  totalSteps: number;
  stepOf: (record: Record) => number;
  valueOf?: (record: Record) => Value;
  apply: (step: number, values: Value[]) => Result | Promise<Result>;
  onStep?: ((step: number, result: Result) => void | Promise<void>) | null;
}): Promise<Result | undefined>;
