import { readFile } from "node:fs/promises";
import { catalogComputerContentGraph } from "../src/type/computer-content-graph.mjs";

export async function catalogComputerContentGraphFile(pathname, {
  read = readFile,
  write = (text) => process.stdout.write(text),
} = {}) {
  if (typeof pathname !== "string" || pathname === "") {
    throw new TypeError("catalog-computer-content-graph requires one JSON resource-set path");
  }
  const source = await read(pathname, "utf8");
  const input = JSON.parse(source);
  const catalog = catalogComputerContentGraph(input);
  write(`${JSON.stringify(catalog)}\n`);
  return catalog;
}
