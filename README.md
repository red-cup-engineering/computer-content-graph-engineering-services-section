# Computer content graph engineering services section

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/red-cup-engineering/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

This is the one content-graph owner beneath computer content engineering.
It does not call a graph a generic data structure and leave every consumer to
invent its own content meaning. A graph here is an addressed, typed reading of
content and the relations witnessed in that reading.

`src/type/computer-content-graph` is the pure composition boundary. It invokes
the published `workspace-content-graph-service` contract to observe package
manifests, schemas, and Markdown. The resulting `ComputerContentGraph` names
that one observation without claiming that a content identifier proves
anything about an external referent.

`scripts/catalog-computer-content-graph` is the explicit filesystem boundary:
it reads a JSON resource set and writes the deterministic catalog. The
`computer-content-graph-engine` app is only that operation's CLI face; it does
not define another graph model.

The leaf services are deliberately narrow:

- SignGraph supplies deterministic directed-graph carriers, renderings, and
  relation-web organization.
- `workspace-content-graph-service` observes a workspace corpus and produces
  the typed content reading.
- `operations-graph-service` records admitted operational relations and their
  obstructions.
- `computer-graph-serialization-services-section` owns representation bindings.

The dependency direction is therefore engineering → computer engineering →
computer data engineering → computer content engineering → this section.
No leaf service needs to recreate the content type or a second engine.
