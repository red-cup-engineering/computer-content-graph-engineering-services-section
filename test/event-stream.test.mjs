import assert from "node:assert/strict";
import test from "node:test";
import { createAppendOnlyLog, createIncrementalProjection, createKeyedNumberedHistory, createValidatedQueue, replayEventStream } from "../scripts/event-stream.mjs";

test("validated queue preserves admitted order and has one drain boundary", () => {
  const queue = createValidatedQueue({ validate: (value) => value?.ok ? { id: value.id } : null });
  assert.deepEqual(queue.push({ id: "a", ok: true }), { id: "a" });
  assert.equal(queue.push({ id: "b", ok: false }), null);
  queue.push({ id: "c", ok: true });
  assert.deepEqual(queue.drain(), [{ id: "a" }, { id: "c" }]);
  assert.deepEqual(queue.drain(), []);
});

test("validated queue may admit falsey values while null and undefined refuse", () => {
  const queue = createValidatedQueue({ validate: (value) => value === "refuse" ? null : value });
  assert.equal(queue.push(false), false);
  assert.equal(queue.push(0), 0);
  assert.equal(queue.push("refuse"), null);
  assert.deepEqual(queue.drain(), [false, 0]);
});

test("append-only log keeps canonical records without exposing its backing array", () => {
  const log = createAppendOnlyLog({ canonicalize: (record) => ({ id: String(record.id) }) });
  const input = { id: 1 };
  log.append(input);
  input.id = 2;
  const copy = log.all();
  copy.push({ id: "extra" });
  assert.deepEqual(log.all(), [{ id: "1" }]);
});

test("keyed numbered history is bounded, independent, and honestly detects an aged-out cursor", () => {
  const history = createKeyedNumberedHistory(2, { numberOf: (entry) => entry.tick });
  history.push("a", { tick: 1, value: "first" });
  history.push("a", { tick: 2, value: "second" });
  history.push("b", { tick: 9, value: "separate" });
  assert.deepEqual(history.since("a", 0).map((entry) => entry.value), ["first", "second"]);
  history.push("a", { tick: 3, value: "third" });
  assert.equal(history.since("a", 0), null);
  assert.deepEqual(history.since("a", 1).map((entry) => entry.value), ["second", "third"]);
  assert.deepEqual(history.since("b", 8).map((entry) => entry.value), ["separate"]);
  history.drop("a");
  assert.equal(history.since("a", 2), null);
});

test("incremental projection refreshes dirty subjects and tracks per-subscriber removals", async () => {
  const values = new Map([["a", { id: "a", value: 1 }], ["b", { id: "b", value: 2 }]]);
  const projection = createIncrementalProjection({ subjectsOf: async () => values.keys(), entryOf: async (id) => values.get(id) ?? null, interest: (id, subscriber) => subscriber !== "only-a" || id === "a" });
  assert.deepEqual((await projection.bootstrap(0)).entries.map((entry) => entry.id), ["a", "b"]);
  const subscriber = projection.subscribe("only-a");
  assert.deepEqual(subscriber.full(0).entries.map((entry) => entry.id), ["a"]);
  values.delete("a");
  assert.deepEqual(await projection.refresh(["a"], 1), { type: "delta", step: 1, entries: [], removed: ["a"] });
  assert.deepEqual(subscriber.delta(1, 7), { type: "delta", step: 1, entries: [], removed: ["a"], acknowledged: 7 });
});

test("incremental projection removes the prior entry id when subject and projection identity differ", async () => {
  const values = new Map([["subject-a", { id: "view-a", value: 1 }]]);
  const projection = createIncrementalProjection({
    subjectsOf: async () => values.keys(),
    entryOf: async (subject) => values.get(subject) ?? null,
  });
  await projection.bootstrap(0);
  values.delete("subject-a");
  assert.deepEqual(await projection.refresh(["subject-a"], 1), {
    type: "delta", step: 1, entries: [], removed: ["view-a"],
  });
  assert.equal(projection.size(), 0);
});

test("replay applies empty steps in order", async () => {
  const seen = [];
  await replayEventStream([{ tick: 2, value: "x" }], { totalSteps: 3, stepOf: (record) => record.tick, valueOf: (record) => record.value, apply: async (step, values) => seen.push([step, values]) });
  assert.deepEqual(seen, [[1, []], [2, ["x"]], [3, []]]);
});

test("replay refuses records outside the declared numbered-step domain", async () => {
  await assert.rejects(
    replayEventStream([{ step: 0 }], { totalSteps: 3, stepOf: (record) => record.step, apply: async () => {} }),
    /within totalSteps/,
  );
});
