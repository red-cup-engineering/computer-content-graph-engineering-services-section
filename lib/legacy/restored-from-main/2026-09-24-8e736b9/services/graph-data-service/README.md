# graph-data-service

Small, dependency-free primitives for directed graphs of typed nodes and
edges. This is the shared nodes-and-edges layer that operations graphs,
dependency DAGs, and entity networks keep re-implementing locally; it is
deliberately neutral about node vocabulary, edge vocabulary, persistence, and
rendering beyond plain-text serialization.

The package provides:

- `createGraph`: a directed multigraph; edges imply their endpoint nodes,
  identical edges append once, and a node's `data` is supplied at most once —
  a different second value is refused, never averaged.
- `topologicalOrder` / `isAcyclic`: Kahn ordering that returns either a
  complete order or the node ids of a remaining cycle, never both.
- `topologicalTiers`: Kahn ordering grouped into independent level tiers
  (tier *k*'s members have no edge between them) for a build-order or
  parallel-schedule caller — `tiers` always reflects what could be placed,
  with an accompanying `cycle` naming anything that couldn't.
- `stronglyConnectedComponents`: the full SCC partition of every node —
  including trivial, non-cyclic length-1 components — for condensation or
  ranking callers that need the whole partition, not just its cyclic part.
- `cycles`: `stronglyConnectedComponents` filtered to the cyclic part of
  that partition — a self-loop as a length-1 component, each non-trivial
  strongly connected component naming every node id in it — for callers
  that need to report distinct cycles rather than `topologicalOrder`'s
  single merged cyclic core.
- `reachable`: transitive reachability, optionally restricted to one edge
  kind.
- `neighborhood`: the bounded-depth, bidirectional "ego graph" of one node —
  everything within `downDepth` outgoing and `upDepth` incoming hops — for
  a caller that wants a node's neighborhood rather than full reachability.
  Pair with `subgraph` for the closed neighborhood graph.
- `shortestPath`: Dijkstra shortest path between two nodes, weighted by an
  optional `weight(edge)` (default 1, i.e. fewest hops); dependency-free
  binary-heap implementation, so a caller building a weighted graph never
  needs its own copy of Dijkstra.
- `distances`: BFS hop-count distances from one node, optionally capped at
  `maxDepth` — `reachable`'s hop-counted, depth-bounded sibling, for a
  caller that wants distances rather than membership.
- `mergeGraphs`: set-union merge whose result does not depend on argument
  order; conflicting node data is a refused conflict.
- `subgraph`: restriction to a node set and the edges between them.
- `toJson` / `fromJson`: deterministic, sorted plain-data form suitable for
  content addressing and journaling.
- `toDot` / `toMermaid`: deterministic Graphviz and mermaid text, replacing
  hand-rolled emitters at call sites.

This is intentionally not an operations graph, a FARS, a FERN, or a FROG. It
carries whatever node kinds, edge kinds, and admission discipline an owning
application supplies; those systems are its consumers, not its concerns.
