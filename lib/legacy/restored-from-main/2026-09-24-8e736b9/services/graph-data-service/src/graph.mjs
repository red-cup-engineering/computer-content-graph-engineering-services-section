/**
 * Canonical JSON with recursively sorted object keys, so structurally equal
 * values serialize identically regardless of construction order.
 */
import { canonicalJson } from "@red-cup-engineering/json-services-section/canonical-json";
const edgeKey = (edge) => canonicalJson([edge.from, edge.kind, edge.to, edge.data]);

const edgesAt = (edgesByNode, id, { kind } = {}) => {
  const edges = edgesByNode.get(id) ?? [];
  return kind === undefined ? edges.slice() : edges.filter((edge) => edge.kind === kind);
};

/**
 * A directed multigraph of typed nodes and edges. Node identity is its `id`
 * string; edge identity is the canonical form of `{from, kind, to, data}`, so
 * appending the same edge twice is a no-op and merge is plain set union.
 * Nodes may arise implicitly from edges; a node's `data` may be supplied once,
 * and a second, different `data` for the same id is refused, not averaged.
 */
export function createGraph({ nodes = [], edges = [] } = {}) {
  const nodeById = new Map();
  const edgeByKey = new Map();
  const outgoingByNode = new Map();
  const incomingByNode = new Map();

  function ensureNode(id) {
    if (typeof id !== "string" || id.length === 0) throw new TypeError("node id must be a non-empty string");
    if (!nodeById.has(id)) {
      nodeById.set(id, Object.freeze({ id, data: undefined }));
      outgoingByNode.set(id, []);
      incomingByNode.set(id, []);
    }
    return nodeById.get(id);
  }

  const graph = {
    addNode(id, data = undefined) {
      const existing = ensureNode(id);
      if (data === undefined) return existing;
      if (existing.data === undefined) {
        const node = Object.freeze({ id, data });
        nodeById.set(id, node);
        return node;
      }
      if (canonicalJson(existing.data) !== canonicalJson(data)) {
        throw new Error(`node ${JSON.stringify(id)} already has different data`);
      }
      return existing;
    },
    addEdge({ from, to, kind = "edge", data = undefined }) {
      ensureNode(from);
      ensureNode(to);
      if (typeof kind !== "string" || kind.length === 0) throw new TypeError("edge kind must be a non-empty string");
      const edge = Object.freeze({ from, to, kind, data });
      const key = edgeKey(edge);
      if (edgeByKey.has(key)) return edgeByKey.get(key);
      edgeByKey.set(key, edge);
      outgoingByNode.get(from).push(edge);
      incomingByNode.get(to).push(edge);
      return edge;
    },
    hasNode: (id) => nodeById.has(id),
    node: (id) => nodeById.get(id),
    nodes: () => [...nodeById.values()],
    edges: ({ kind } = {}) => {
      const all = [...edgeByKey.values()];
      return kind === undefined ? all : all.filter((edge) => edge.kind === kind);
    },
    outgoing: (id, filter = {}) => edgesAt(outgoingByNode, id, filter),
    incoming: (id, filter = {}) => edgesAt(incomingByNode, id, filter),
    order: () => nodeById.size,
    size: () => edgeByKey.size,
  };

  for (const node of nodes) graph.addNode(node.id, node.data);
  for (const edge of edges) graph.addEdge(edge);
  return graph;
}

/**
 * Kahn topological order. Returns `{order}` when the graph is acyclic and
 * `{cycle}` naming the node ids of one remaining strongly connected region
 * otherwise; never both.
 */
export function topologicalOrder(graph, { kind } = {}) {
  const remaining = new Map(graph.nodes().map((node) => [node.id, graph.incoming(node.id, { kind }).length]));
  const ready = [...remaining].filter(([, degree]) => degree === 0).map(([id]) => id);
  const order = [];
  while (ready.length > 0) {
    const id = ready.shift();
    remaining.delete(id);
    order.push(id);
    for (const edge of graph.outgoing(id, { kind })) {
      const degree = remaining.get(edge.to);
      if (degree === undefined) continue;
      if (degree === 1) ready.push(edge.to);
      remaining.set(edge.to, degree - 1);
    }
  }
  if (remaining.size === 0) return { order };
  return { cycle: [...remaining.keys()] };
}

/** True when the graph (restricted to `kind`, if given) has no directed cycle. */
export function isAcyclic(graph, { kind } = {}) {
  return topologicalOrder(graph, { kind }).order !== undefined;
}

/**
 * Kahn topological order grouped into level tiers: tier 0 holds every node
 * with no incoming edge (restricted to `kind`, if given), tier *k* holds
 * every node whose predecessors are all in tiers `< k`. Nodes in the same
 * tier have no edge between them, so a tier's members are independent —
 * the shape a build-order or parallel-schedule caller wants, which
 * `topologicalOrder`'s flat order discards. `cycle`, present only when
 * some nodes could not be placed in any tier, names them (as
 * `topologicalOrder`'s `cycle` does); `tiers` always reflects what could
 * be placed, unlike `topologicalOrder`'s all-or-nothing contract.
 */
export function topologicalTiers(graph, { kind } = {}) {
  const remaining = new Map(graph.nodes().map((node) => [node.id, graph.incoming(node.id, { kind }).length]));
  const tiers = [];
  let frontier = [...remaining].filter(([, degree]) => degree === 0).map(([id]) => id);
  while (frontier.length > 0) {
    tiers.push(frontier);
    const next = [];
    for (const id of frontier) {
      remaining.delete(id);
      for (const edge of graph.outgoing(id, { kind })) {
        const degree = remaining.get(edge.to);
        if (degree === undefined) continue;
        if (degree === 1) next.push(edge.to);
        remaining.set(edge.to, degree - 1);
      }
    }
    frontier = next;
  }
  if (remaining.size === 0) return { tiers };
  return { tiers, cycle: [...remaining.keys()] };
}

/**
 * The bounded-depth neighborhood of `start`: `start` itself, every node
 * within `downDepth` outgoing hops, and every node within `upDepth`
 * incoming hops, optionally restricted to one edge kind. This is
 * `reachable`'s depth-bounded, bidirectional sibling — the "ego graph" a
 * network-analysis caller wants instead of full transitive reachability.
 * Pair with `subgraph` to get the closed neighborhood graph itself.
 */
export function neighborhood(graph, start, { downDepth = 1, upDepth = 1, kind } = {}) {
  const keep = new Set();
  if (!graph.hasNode(start)) return keep;
  keep.add(start);
  const expand = (step, depth) => {
    let frontier = [start];
    for (let hop = 0; hop < depth; hop += 1) {
      const next = [];
      for (const id of frontier) {
        for (const neighbor of step(id)) {
          if (keep.has(neighbor)) continue;
          keep.add(neighbor);
          next.push(neighbor);
        }
      }
      frontier = next;
    }
  };
  expand((id) => graph.outgoing(id, { kind }).map((edge) => edge.to), downDepth);
  expand((id) => graph.incoming(id, { kind }).map((edge) => edge.from), upDepth);
  return keep;
}

/**
 * Every strongly connected component (restricted to `kind`, if given),
 * partitioning every node: a node with no cyclic relation to any other is
 * its own length-1 component alongside the multi-node ones. Iterative
 * Tarjan's algorithm (an explicit work stack standing in for recursion) so
 * a dense graph can't blow the call stack. The building block for `cycles`
 * and for condensation/ranking callers that need the whole partition, not
 * just the cyclic part of it.
 */
export function stronglyConnectedComponents(graph, { kind } = {}) {
  const nodeIds = graph.nodes().map((node) => node.id);
  let counter = 0;
  const stack = [];
  const onStack = new Set();
  const indices = new Map();
  const lowlink = new Map();
  const components = [];

  function strongConnect(start) {
    const successorsOf = (id) => graph.outgoing(id, { kind }).map((edge) => edge.to);
    const work = [[start, successorsOf(start), 0]];
    indices.set(start, counter);
    lowlink.set(start, counter);
    counter += 1;
    stack.push(start);
    onStack.add(start);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const [cur, succs] = frame;
      let advanced = false;
      while (frame[2] < succs.length) {
        const w = succs[frame[2]];
        frame[2] += 1;
        if (!indices.has(w)) {
          indices.set(w, counter);
          lowlink.set(w, counter);
          counter += 1;
          stack.push(w);
          onStack.add(w);
          work.push([w, successorsOf(w), 0]);
          advanced = true;
          break;
        } else if (onStack.has(w)) {
          lowlink.set(cur, Math.min(lowlink.get(cur), indices.get(w)));
        }
      }
      if (advanced) continue;
      if (lowlink.get(cur) === indices.get(cur)) {
        const comp = [];
        let x;
        do {
          x = stack.pop();
          onStack.delete(x);
          comp.push(x);
        } while (x !== cur);
        components.push(comp);
      }
      work.pop();
      if (work.length > 0) {
        const parentCur = work[work.length - 1][0];
        lowlink.set(parentCur, Math.min(lowlink.get(parentCur), lowlink.get(cur)));
      }
    }
  }

  for (const id of nodeIds) {
    if (!indices.has(id)) strongConnect(id);
  }

  return components;
}

/**
 * Every directed cycle, as separate components rather than one merged core.
 * A self-loop is its own length-1 component; each non-trivial strongly
 * connected component (restricted to `kind`, if given) is one component
 * naming every node id in it. Acyclic node ids are omitted entirely — this
 * is `stronglyConnectedComponents` filtered to the cyclic part of the
 * partition.
 */
export function cycles(graph, { kind } = {}) {
  return stronglyConnectedComponents(graph, { kind }).filter((component) => component.length > 1
    || graph.outgoing(component[0], { kind }).some((edge) => edge.to === component[0]));
}

/**
 * The set of node ids reachable from `start` (a node id or array of ids) by
 * one or more edges, optionally restricted to one edge kind. Excludes the
 * start nodes themselves unless a cycle returns to them.
 */
export function reachable(graph, start, { kind } = {}) {
  const frontier = (Array.isArray(start) ? start : [start]).filter((id) => graph.hasNode(id));
  const seen = new Set();
  while (frontier.length > 0) {
    const id = frontier.pop();
    for (const edge of graph.outgoing(id, { kind })) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      frontier.push(edge.to);
    }
  }
  return seen;
}

// Minimal binary min-heap keyed by `.cost`, private to shortestPath so the
// package stays dependency-free.
class MinHeap {
  constructor() {
    this.items = [];
  }

  size() {
    return this.items.length;
  }

  push(item) {
    this.items.push(item);
    this.siftUp(this.items.length - 1);
  }

  pop() {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  siftUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].cost <= this.items[i].cost) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }

  siftDown(i) {
    const n = this.items.length;
    for (;;) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let smallest = i;
      if (left < n && this.items[left].cost < this.items[smallest].cost) smallest = left;
      if (right < n && this.items[right].cost < this.items[smallest].cost) smallest = right;
      if (smallest === i) break;
      [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
      i = smallest;
    }
  }
}

/**
 * Dijkstra shortest path from `from` to `to` (restricted to `kind`, if
 * given). `weight(edge)` gives each edge's nonnegative finite cost, default
 * 1 (unweighted). Returns `{ path, cost }` naming every node id from
 * `from` to `to` inclusive, or `null` when `to` is unreachable (or either
 * endpoint is absent). Throws if any edge weight is negative or non-finite
 * — Dijkstra does not support them.
 */
export function shortestPath(graph, from, to, { kind, weight = () => 1 } = {}) {
  if (!graph.hasNode(from) || !graph.hasNode(to)) return null;
  if (from === to) return { path: [from], cost: 0 };

  const dist = new Map([[from, 0]]);
  const prev = new Map();
  const visited = new Set();
  const heap = new MinHeap();
  heap.push({ id: from, cost: 0 });

  while (heap.size() > 0) {
    const { id, cost } = heap.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    if (id === to) break;
    for (const edge of graph.outgoing(id, { kind })) {
      if (visited.has(edge.to)) continue;
      const edgeWeight = weight(edge);
      if (!Number.isFinite(edgeWeight) || edgeWeight < 0) {
        throw new TypeError(`shortestPath requires a nonnegative finite edge weight, got ${edgeWeight} for ${edge.from} -> ${edge.to}`);
      }
      const next = cost + edgeWeight;
      if (next < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, next);
        prev.set(edge.to, id);
        heap.push({ id: edge.to, cost: next });
      }
    }
  }

  if (!dist.has(to)) return null;
  const path = [to];
  let cur = to;
  while (cur !== from) {
    cur = prev.get(cur);
    path.push(cur);
  }
  path.reverse();
  return { path, cost: dist.get(to) };
}

/**
 * BFS hop-count distances from `start` (restricted to `kind`, if given),
 * capped at `maxDepth` hops (default Infinity). Returns a Map from every
 * node reached within the cap to its hop count, including `start` itself
 * at 0, or an empty Map when `start` is absent. This is `reachable`'s
 * hop-counted, depth-bounded sibling — for a caller that wants distances,
 * not just membership.
 */
export function distances(graph, start, { kind, maxDepth = Infinity } = {}) {
  const dist = new Map();
  if (!graph.hasNode(start)) return dist;
  dist.set(start, 0);
  const queue = [start];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    const depth = dist.get(current);
    if (depth >= maxDepth) continue;
    for (const edge of graph.outgoing(current, { kind })) {
      if (dist.has(edge.to)) continue;
      dist.set(edge.to, depth + 1);
      queue.push(edge.to);
    }
  }
  return dist;
}

/**
 * Set-union merge. Node and edge sets union by identity, so the result does
 * not depend on argument order; two graphs giving one node id different data
 * is a refused conflict, not a silent overwrite.
 */
export function mergeGraphs(...graphs) {
  const merged = createGraph();
  for (const graph of graphs) {
    for (const node of graph.nodes()) merged.addNode(node.id, node.data);
    for (const edge of graph.edges()) merged.addEdge(edge);
  }
  return merged;
}

/** The graph restricted to `nodeIds` and the edges between them. */
export function subgraph(graph, nodeIds) {
  const keep = new Set(nodeIds);
  const restricted = createGraph();
  for (const id of keep) {
    const node = graph.node(id);
    if (node) restricted.addNode(node.id, node.data);
  }
  for (const edge of graph.edges()) {
    if (keep.has(edge.from) && keep.has(edge.to)) restricted.addEdge(edge);
  }
  return restricted;
}

/** Deterministic plain-data form: nodes and edges sorted by identity. */
export function toJson(graph) {
  const nodes = graph.nodes().map(({ id, data }) => (data === undefined ? { id } : { id, data }));
  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const edges = graph.edges().map(({ from, to, kind, data }) => (data === undefined ? { from, to, kind } : { from, to, kind, data }));
  edges.sort((a, b) => {
    const left = edgeKey(a);
    const right = edgeKey(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return { nodes, edges };
}

/** Rebuild a graph from `toJson` output (or any `{nodes, edges}` shape). */
export function fromJson(json) {
  return createGraph({ nodes: json.nodes ?? [], edges: json.edges ?? [] });
}

const quote = (text) => `"${String(text).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
const dotId = (text) => (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(text) ? text : quote(text));

/**
 * Graphviz DOT text, deterministically ordered. `label` names the digraph
 * (bare when it is a valid DOT identifier); `rankdir` sets layout direction;
 * `nodeLabel` chooses per-node label text; `edgeLabel` chooses per-edge label
 * text (default: the kind, when not "edge").
 */
export function toDot(graph, {
  label = "graph_data",
  rankdir = undefined,
  nodeLabel = () => undefined,
  edgeLabel = (edge) => (edge.kind === "edge" ? undefined : edge.kind),
} = {}) {
  const { nodes, edges } = toJson(graph);
  const lines = [`digraph ${dotId(label)} {`];
  if (rankdir !== undefined) lines.push(`  rankdir=${rankdir};`);
  for (const node of nodes) {
    const text = nodeLabel(node);
    const attrs = text === undefined ? "" : ` [label=${quote(text)}]`;
    lines.push(`  ${quote(node.id)}${attrs};`);
  }
  for (const edge of edges) {
    const text = edgeLabel(edge);
    const attrs = text === undefined ? "" : ` [label=${quote(text)}]`;
    lines.push(`  ${quote(edge.from)} -> ${quote(edge.to)}${attrs};`);
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}

const mermaidId = (id) => id.replaceAll(/[^A-Za-z0-9_]/gu, "_");

/** Mermaid flowchart text, deterministically ordered, for markdown contexts. */
export function toMermaid(graph, { direction = "TD" } = {}) {
  const { nodes, edges } = toJson(graph);
  const lines = [`flowchart ${direction}`];
  for (const node of nodes) lines.push(`  ${mermaidId(node.id)}[${quote(node.id)}]`);
  for (const edge of edges) {
    const arrow = edge.kind === "edge" ? "-->" : `-- ${edge.kind} -->`;
    lines.push(`  ${mermaidId(edge.from)} ${arrow} ${mermaidId(edge.to)}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Losslessly project a witnessed semantic graph into the generic navigable
 * graph. Semantic admission stays with the semantic carrier; node type and
 * addressed edge witness remain queryable projection data.
 */
export function projectSignGraphTopology(graph) {
  const topology = createGraph();
  for (const cell of graph.cells) topology.addNode(cell.id, Object.freeze({ kind: cell.kind, type: cell.type }));
  for (const entry of graph.edges) topology.addEdge({ from: entry.edge.subject.id, to: entry.edge.object.id, kind: entry.edge.predicate, data: Object.freeze({ id: entry.id, witness: entry.edge.witness.id }) });
  return topology;
}
