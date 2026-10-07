// An AOG-shaped operations graph, built on the base graph carrier at
// SignGraph.
//
// A node is `{ id, kind, payload, acts, status }` — AOG's RecognitionObject
// (`aog.py`'s `RecognitionObject`, `status` in {"loaded", "live"}). An edge
// is `{ from, kind, to, evidence }`. The graph never grows by fiat: a node or
// edge enters only through admit (propose -> validate -> promote). A node
// that fails validation is refused — recorded as a typed journal entry, not
// added, and never thrown. An edge that fails validation, when both its
// endpoints already exist, is not silently dropped either: it is admitted as
// an `"obstruction"`-kind edge instead of its proposed kind, carrying the
// validation errors as its evidence, so the failure stays visible in the
// graph the same way a generation or witness edge would. The full sequence
// of admissions is a witness journal; `replay` folds one back into the exact
// same graph, independent of whatever validation rules produced it.
//
// This package keeps its own admitted nodes/edges as plain frozen arrays
// (its own concern) and only reaches for SignGraph to run the
// shared algorithms — DAG check, topological order, reachability, DOT
// rendering — building one disposable base-graph instance per call rather
// than threading its own state through that package's mutable builder.

import {
  createGraph as createBaseGraph,
  isAcyclic,
  reachable,
  toDot as baseToDot,
  topologicalOrder,
} from "@red-cup-engineering/metrologic/models/graphs/directed-multigraph";

function fail(message) {
  throw new TypeError(message);
}

function validateId(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string`);
}

function freezePlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be a plain object`);
  return Object.freeze({ ...value });
}

/**
 * Build one node proposal: AOG's RecognitionObject shape, `status: "loaded"`
 * until it is admitted.
 */
export function proposeNode({ id, kind, payload = {}, acts = [] } = {}) {
  validateId(id, "node.id");
  validateId(kind, "node.kind");
  if (!Array.isArray(acts)) fail("node.acts must be an array");
  return Object.freeze({
    id,
    kind,
    payload: freezePlainObject(payload, "node.payload"),
    acts: Object.freeze([...acts]),
    status: "loaded",
  });
}

/** Build one edge proposal. `evidence` carries whatever licensed this edge. */
export function proposeEdge({ from, kind, to, evidence = {} } = {}) {
  validateId(from, "edge.from");
  validateId(kind, "edge.kind");
  validateId(to, "edge.to");
  return Object.freeze({ from, kind, to, evidence: freezePlainObject(evidence, "edge.evidence") });
}

/** An empty operations graph: no nodes, no edges, no journal entries. */
export function createOperationsGraph() {
  return Object.freeze({ nodes: Object.freeze([]), edges: Object.freeze([]), journal: Object.freeze([]) });
}

function withState(operationsGraph, { nodes = operationsGraph.nodes, edges = operationsGraph.edges, entry }) {
  return Object.freeze({
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    journal: Object.freeze([...operationsGraph.journal, Object.freeze(entry)]),
  });
}

/**
 * Validate one node proposal: structurally (its id must not already be
 * present) plus every caller-supplied rule, each `(node, operationsGraph) =>
 * true | string`. Never throws; returns `{ ok, errors }`.
 */
export function validateNode(operationsGraph, node, rules = []) {
  const errors = [];
  if (operationsGraph.nodes.some((existing) => existing.id === node.id)) errors.push(`duplicate node id: ${node.id}`);
  for (const rule of rules) {
    const outcome = rule(node, operationsGraph);
    if (outcome !== true) errors.push(typeof outcome === "string" ? outcome : `node ${node.id} failed a validation rule`);
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

/**
 * Admit one proposed node. On success the node is promoted to `status:
 * "live"` and appended. On failure the graph is returned unchanged and the
 * refusal is the journal entry — never a thrown exception. Returns `{
 * operationsGraph, outcome }`.
 */
export function admitNode(operationsGraph, node, { rules = [] } = {}) {
  const validation = validateNode(operationsGraph, node, rules);
  if (!validation.ok) {
    return {
      operationsGraph: withState(operationsGraph, { entry: { type: "node-refused", nodeId: node.id, errors: validation.errors } }),
      outcome: validation,
    };
  }
  const live = Object.freeze({ ...node, status: "live" });
  return {
    operationsGraph: withState(operationsGraph, {
      nodes: [...operationsGraph.nodes, live],
      entry: { type: "node-admitted", node: live },
    }),
    outcome: validation,
  };
}

/**
 * Validate one edge proposal: structurally (both endpoints must already be
 * live in the graph) plus every caller-supplied rule, each `(edge,
 * operationsGraph) => true | string`. Never throws; returns `{ ok, errors }`.
 */
export function validateEdge(operationsGraph, edge, rules = []) {
  const errors = [];
  if (!operationsGraph.nodes.some((node) => node.id === edge.from)) errors.push(`edge.from is not a live node: ${edge.from}`);
  if (!operationsGraph.nodes.some((node) => node.id === edge.to)) errors.push(`edge.to is not a live node: ${edge.to}`);
  for (const rule of rules) {
    const outcome = rule(edge, operationsGraph);
    if (outcome !== true) errors.push(typeof outcome === "string" ? outcome : `edge ${edge.from}->${edge.to} failed a validation rule`);
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

/**
 * Admit one proposed edge. On success it is appended with its proposed kind.
 * On failure, if both endpoints already exist as live nodes, the edge is
 * still appended — as an `"obstruction"`-kind edge whose evidence carries
 * the attempted kind and the validation errors — so the failure stays
 * visible and queryable in the graph rather than silently dropped. If an
 * endpoint does not exist at all, no edge (obstruction or otherwise) can be
 * attached, and the refusal is journal-only. Never throws. Returns `{
 * operationsGraph, outcome }`.
 */
export function admitEdge(operationsGraph, edge, { rules = [] } = {}) {
  const validation = validateEdge(operationsGraph, edge, rules);
  if (validation.ok) {
    return {
      operationsGraph: withState(operationsGraph, { edges: [...operationsGraph.edges, edge], entry: { type: "edge-admitted", edge } }),
      outcome: validation,
    };
  }
  const endpointsExist = operationsGraph.nodes.some((node) => node.id === edge.from)
    && operationsGraph.nodes.some((node) => node.id === edge.to);
  if (!endpointsExist) {
    return {
      operationsGraph: withState(operationsGraph, {
        entry: { type: "edge-refused", from: edge.from, kind: edge.kind, to: edge.to, errors: validation.errors },
      }),
      outcome: validation,
    };
  }
  const obstruction = Object.freeze({
    from: edge.from,
    kind: "obstruction",
    to: edge.to,
    evidence: Object.freeze({ attemptedKind: edge.kind, errors: validation.errors }),
  });
  return {
    operationsGraph: withState(operationsGraph, {
      edges: [...operationsGraph.edges, obstruction],
      entry: { type: "edge-obstructed", obstruction },
    }),
    outcome: validation,
  };
}

/**
 * Replay a witness journal (as produced by {@link admitNode}/{@link
 * admitEdge}'s `operationsGraph.journal`) into a fresh operations graph.
 * Deterministic and independent of whatever validation rules originally
 * produced the journal: admitted nodes and edges (including obstructions)
 * are folded back in directly; refusals contribute a journal entry only, no
 * graph change, exactly as they did the first time.
 */
export function replay(journal) {
  let operationsGraph = createOperationsGraph();
  for (const entry of journal) {
    if (entry.type === "node-admitted") {
      operationsGraph = withState(operationsGraph, { nodes: [...operationsGraph.nodes, entry.node], entry });
    } else if (entry.type === "edge-admitted") {
      operationsGraph = withState(operationsGraph, { edges: [...operationsGraph.edges, entry.edge], entry });
    } else if (entry.type === "edge-obstructed") {
      operationsGraph = withState(operationsGraph, { edges: [...operationsGraph.edges, entry.obstruction], entry });
    } else if (entry.type === "node-refused" || entry.type === "edge-refused") {
      operationsGraph = withState(operationsGraph, { entry });
    } else {
      fail(`unknown witness journal entry type: ${entry.type}`);
    }
  }
  return operationsGraph;
}

/** Build one disposable SignGraph graph from the current admitted nodes/edges. */
function toBaseGraph(operationsGraph) {
  return createBaseGraph({
    nodes: operationsGraph.nodes.map((node) => ({ id: node.id, data: node })),
    edges: operationsGraph.edges.map((edge) => ({ from: edge.from, to: edge.to, kind: edge.kind, data: edge })),
  });
}

/** `true` iff the operations graph has no directed cycle. Delegates to SignGraph's `isAcyclic`. */
export function isDag(operationsGraph) {
  return isAcyclic(toBaseGraph(operationsGraph));
}

/**
 * A topological order of admitted node ids: every edge points forward.
 * Throws if the graph is not a DAG. Delegates to SignGraph's
 * `topologicalOrder`.
 */
export function topoSort(operationsGraph) {
  const { order, cycle } = topologicalOrder(toBaseGraph(operationsGraph));
  if (order === undefined) fail(`graph is not a DAG: found a cycle among ${cycle.join(", ")}`);
  return Object.freeze(order);
}

/** `true` iff `toId` is reachable from `fromId`. Delegates to SignGraph's `reachable`. */
export function reaches(operationsGraph, fromId, toId) {
  return reachable(toBaseGraph(operationsGraph), fromId).has(toId);
}

/** Graphviz DOT text for the operations graph. Delegates to SignGraph's `toDot`. */
export function toDot(operationsGraph, options) {
  return baseToDot(toBaseGraph(operationsGraph), options);
}
