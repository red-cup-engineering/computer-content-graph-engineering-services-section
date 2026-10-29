export interface GraphNode {
  readonly id: string;
  readonly data: unknown;
}

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  readonly data: unknown;
}

export interface EdgeInput {
  from: string;
  to: string;
  kind?: string;
  data?: unknown;
}

export interface KindFilter {
  kind?: string;
}

export interface Graph {
  addNode(id: string, data?: unknown): GraphNode;
  addEdge(edge: EdgeInput): GraphEdge;
  hasNode(id: string): boolean;
  node(id: string): GraphNode | undefined;
  nodes(): GraphNode[];
  edges(filter?: KindFilter): GraphEdge[];
  outgoing(id: string, filter?: KindFilter): GraphEdge[];
  incoming(id: string, filter?: KindFilter): GraphEdge[];
  order(): number;
  size(): number;
}

export interface GraphJson {
  nodes: Array<{ id: string; data?: unknown }>;
  edges: Array<{ from: string; to: string; kind: string; data?: unknown }>;
}

export function canonicalJson(value: unknown): string;
export function createGraph(init?: { nodes?: Array<{ id: string; data?: unknown }>; edges?: EdgeInput[] }): Graph;
export function topologicalOrder(graph: Graph, filter?: KindFilter): { order?: string[]; cycle?: string[] };
export function topologicalTiers(graph: Graph, filter?: KindFilter): { tiers: string[][]; cycle?: string[] };
export function isAcyclic(graph: Graph, filter?: KindFilter): boolean;
export function stronglyConnectedComponents(graph: Graph, filter?: KindFilter): string[][];
export function cycles(graph: Graph, filter?: KindFilter): string[][];
export function reachable(graph: Graph, start: string | string[], filter?: KindFilter): Set<string>;
export function neighborhood(graph: Graph, start: string, options?: KindFilter & { downDepth?: number; upDepth?: number }): Set<string>;
export function shortestPath(graph: Graph, from: string, to: string, options?: KindFilter & { weight?: (edge: GraphEdge) => number }): { path: string[]; cost: number } | null;
export function distances(graph: Graph, start: string, options?: KindFilter & { maxDepth?: number }): Map<string, number>;
export function mergeGraphs(...graphs: Graph[]): Graph;
export function subgraph(graph: Graph, nodeIds: Iterable<string>): Graph;
export function toJson(graph: Graph): GraphJson;
export function fromJson(json: Partial<GraphJson>): Graph;
export function toDot(graph: Graph, options?: { label?: string; rankdir?: string; nodeLabel?: (node: { id: string; data?: unknown }) => string | undefined; edgeLabel?: (edge: GraphEdge) => string | undefined }): string;
export function toMermaid(graph: Graph, options?: { direction?: string }): string;

/** Lossless navigable projection of an already-admitted witnessed semantic graph. */
export function projectSignGraphTopology(graph: { cells: readonly { id: string; kind: string; type: string }[]; edges: readonly { id: string; edge: { subject: { id: string }; object: { id: string }; predicate: string; witness: { id: string } } }[] }): Graph;
