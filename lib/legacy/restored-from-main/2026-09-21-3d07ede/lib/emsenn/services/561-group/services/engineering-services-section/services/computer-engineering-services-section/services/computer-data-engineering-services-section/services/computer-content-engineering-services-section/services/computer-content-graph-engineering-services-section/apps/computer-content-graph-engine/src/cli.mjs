import { catalogComputerContentGraphFile } from "../../../scripts/catalog-computer-content-graph.mjs";

export async function main(arguments_ = process.argv.slice(2), options = {}) {
  if (arguments_.length !== 1) {
    throw new TypeError("usage: computer-content-graph-engine RESOURCE_SET.json");
  }
  return catalogComputerContentGraphFile(arguments_[0], options);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
