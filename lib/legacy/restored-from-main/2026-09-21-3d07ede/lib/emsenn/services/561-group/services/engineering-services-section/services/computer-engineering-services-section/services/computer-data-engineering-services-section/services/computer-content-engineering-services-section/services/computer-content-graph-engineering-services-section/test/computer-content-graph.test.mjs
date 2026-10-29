import assert from "node:assert/strict";
import test from "node:test";
import { main } from "../apps/computer-content-graph-engine/src/cli.mjs";
import { catalogComputerContentGraph } from "../src/type/computer-content-graph.mjs";

test("one content observation forms a ComputerContentGraph", () => {
  const graph = catalogComputerContentGraph({
    resources: [
      { path: "package.json", content: JSON.stringify({ name: "@example/corpus", version: "1.0.0" }) },
      { path: "notes/example.md", content: "---\ntitle: Example\n---\n\n# Example\n" },
    ],
  });

  assert.equal(graph.type, "ComputerContentGraph");
  assert.equal(graph.version, 1);
  assert.equal(graph.observation.type, "WorkspaceContentGraph");
  assert.ok(Number.isInteger(graph.observation.version));
  assert.ok(graph.observation.version >= 1);
  assert.equal(graph.observation.resources.length, 2);
  assert.equal(graph.observation.frontmatterClaims.length, 1);
  assert.ok(Object.isFrozen(graph));
});

test("content graph admission refuses a non-resource array", () => {
  assert.throws(() => catalogComputerContentGraph({ resources: {} }), /resources must be an array/u);
});

test("the engine is a CLI face over the one catalog operation", async () => {
  let output = "";
  const graph = await main(["resources.json"], {
    read: async () => JSON.stringify({ resources: [{ path: "package.json", content: '{"name":"@example/engine","version":"1.0.0"}' }] }),
    write: (text) => { output = text; },
  });

  assert.equal(graph.type, "ComputerContentGraph");
  assert.equal(JSON.parse(output).type, "ComputerContentGraph");
});
