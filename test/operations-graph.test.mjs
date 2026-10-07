import assert from "node:assert/strict";
import test from "node:test";

import {
  admitEdge,
  admitNode,
  createOperationsGraph,
  isDag,
  proposeEdge,
  proposeNode,
  reaches,
  replay,
  toDot,
  topoSort,
  validateEdge,
  validateNode,
} from "../scripts/operations-graph.mjs";

test("proposeNode builds a frozen loaded RecognitionObject and rejects a bad shape", () => {
  const node = proposeNode({ id: "pkg:npm/a@1", kind: "npm-binary", payload: { entry: "bin.js" }, acts: ["installed"] });
  assert.deepEqual(node, {
    id: "pkg:npm/a@1",
    kind: "npm-binary",
    payload: { entry: "bin.js" },
    acts: ["installed"],
    status: "loaded",
  });
  assert.equal(Object.isFrozen(node), true);
  assert.equal(Object.isFrozen(node.payload), true);
  assert.throws(() => proposeNode({ id: "", kind: "k" }), TypeError);
  assert.throws(() => proposeNode({ id: "a", kind: "k", acts: "not-an-array" }), TypeError);
});

test("proposeEdge builds a frozen edge with evidence and rejects a bad shape", () => {
  const edge = proposeEdge({ from: "a", kind: "witness", to: "b", evidence: { checkedBy: "contract" } });
  assert.deepEqual(edge, { from: "a", kind: "witness", to: "b", evidence: { checkedBy: "contract" } });
  assert.equal(Object.isFrozen(edge), true);
  assert.throws(() => proposeEdge({ from: "a", kind: "", to: "b" }), TypeError);
});

test("admitNode promotes a valid proposal to status live and journals it", () => {
  const empty = createOperationsGraph();
  const node = proposeNode({ id: "a", kind: "k" });
  const { operationsGraph, outcome } = admitNode(empty, node);
  assert.equal(outcome.ok, true);
  assert.equal(operationsGraph.nodes.length, 1);
  assert.equal(operationsGraph.nodes[0].status, "live");
  assert.equal(operationsGraph.journal.length, 1);
  assert.equal(operationsGraph.journal[0].type, "node-admitted");
});

test("admitNode refuses a duplicate id without throwing and leaves the graph unchanged", () => {
  const withA = admitNode(createOperationsGraph(), proposeNode({ id: "a", kind: "k" })).operationsGraph;
  const { operationsGraph, outcome } = admitNode(withA, proposeNode({ id: "a", kind: "other" }));
  assert.equal(outcome.ok, false);
  assert.match(outcome.errors[0], /duplicate node id/u);
  assert.equal(operationsGraph.nodes.length, 1);
  assert.equal(operationsGraph.journal.at(-1).type, "node-refused");
});

test("admitNode runs caller-supplied rules and surfaces their message", () => {
  const rule = (node) => (node.kind === "npm-binary" ? true : "only npm-binary nodes are admissible here");
  const { outcome } = admitNode(createOperationsGraph(), proposeNode({ id: "a", kind: "npm-package" }), { rules: [rule] });
  assert.equal(outcome.ok, false);
  assert.deepEqual([...outcome.errors], ["only npm-binary nodes are admissible here"]);
});

test("admitEdge appends a valid edge between two live nodes and journals it", () => {
  let og = createOperationsGraph();
  og = admitNode(og, proposeNode({ id: "a", kind: "k" })).operationsGraph;
  og = admitNode(og, proposeNode({ id: "b", kind: "k" })).operationsGraph;
  const { operationsGraph, outcome } = admitEdge(og, proposeEdge({ from: "a", kind: "generation", to: "b" }));
  assert.equal(outcome.ok, true);
  assert.equal(operationsGraph.edges.length, 1);
  assert.equal(operationsGraph.edges[0].kind, "generation");
  assert.equal(operationsGraph.journal.at(-1).type, "edge-admitted");
});

test("admitEdge turns a failed-rule edge between two live nodes into an obstruction edge", () => {
  let og = createOperationsGraph();
  og = admitNode(og, proposeNode({ id: "a", kind: "k" })).operationsGraph;
  og = admitNode(og, proposeNode({ id: "b", kind: "k" })).operationsGraph;
  const rule = () => "declared contract conflicts with observed behavior";
  const { operationsGraph, outcome } = admitEdge(og, proposeEdge({ from: "a", kind: "witness", to: "b" }), { rules: [rule] });
  assert.equal(outcome.ok, false);
  assert.equal(operationsGraph.edges.length, 1);
  const [edge] = operationsGraph.edges;
  assert.equal(edge.kind, "obstruction");
  assert.equal(edge.from, "a");
  assert.equal(edge.to, "b");
  assert.equal(edge.evidence.attemptedKind, "witness");
  assert.deepEqual([...edge.evidence.errors], ["declared contract conflicts with observed behavior"]);
  assert.equal(operationsGraph.journal.at(-1).type, "edge-obstructed");
});

test("admitEdge with a missing endpoint is journal-only refused, no obstruction edge attaches", () => {
  const og = admitNode(createOperationsGraph(), proposeNode({ id: "a", kind: "k" })).operationsGraph;
  const { operationsGraph, outcome } = admitEdge(og, proposeEdge({ from: "a", kind: "generation", to: "missing" }));
  assert.equal(outcome.ok, false);
  assert.equal(operationsGraph.edges.length, 0);
  assert.equal(operationsGraph.journal.at(-1).type, "edge-refused");
});

test("validateNode and validateEdge never throw for a failing candidate", () => {
  const og = createOperationsGraph();
  assert.doesNotThrow(() => validateNode(og, proposeNode({ id: "a", kind: "k" }), [() => "no"]));
  assert.doesNotThrow(() => validateEdge(og, proposeEdge({ from: "a", kind: "k", to: "b" })));
});

test("replay reproduces the exact same graph from a witness journal, including obstructions and refusals", () => {
  let og = createOperationsGraph();
  og = admitNode(og, proposeNode({ id: "a", kind: "k" })).operationsGraph;
  og = admitNode(og, proposeNode({ id: "b", kind: "k" })).operationsGraph;
  og = admitNode(og, proposeNode({ id: "a", kind: "k" })).operationsGraph; // duplicate -> refused
  og = admitEdge(og, proposeEdge({ from: "a", kind: "generation", to: "b" })).operationsGraph;
  og = admitEdge(og, proposeEdge({ from: "a", kind: "witness", to: "b" }), { rules: [() => "conflict"] }).operationsGraph; // obstructed
  og = admitEdge(og, proposeEdge({ from: "a", kind: "generation", to: "missing" })).operationsGraph; // refused

  const replayed = replay(og.journal);
  assert.deepEqual(replayed.nodes, og.nodes);
  assert.deepEqual(replayed.edges, og.edges);
  assert.deepEqual(replayed.journal, og.journal);
});

test("isDag, topoSort, reaches, and toDot operate on the operations graph directly", () => {
  let og = createOperationsGraph();
  og = admitNode(og, proposeNode({ id: "a", kind: "k" })).operationsGraph;
  og = admitNode(og, proposeNode({ id: "b", kind: "k" })).operationsGraph;
  og = admitEdge(og, proposeEdge({ from: "a", kind: "generation", to: "b" })).operationsGraph;

  assert.equal(isDag(og), true);
  assert.deepEqual([...topoSort(og)], ["a", "b"]);
  assert.equal(reaches(og, "a", "b"), true);
  assert.match(toDot(og), /digraph/u);
});

test("isDag and topoSort detect a cycle formed through obstruction edges", () => {
  let og = createOperationsGraph();
  og = admitNode(og, proposeNode({ id: "a", kind: "k" })).operationsGraph;
  og = admitNode(og, proposeNode({ id: "b", kind: "k" })).operationsGraph;
  og = admitEdge(og, proposeEdge({ from: "a", kind: "generation", to: "b" })).operationsGraph;
  og = admitEdge(og, proposeEdge({ from: "b", kind: "generation", to: "a" })).operationsGraph;

  assert.equal(isDag(og), false);
  assert.throws(() => topoSort(og), /not a DAG/u);
});
