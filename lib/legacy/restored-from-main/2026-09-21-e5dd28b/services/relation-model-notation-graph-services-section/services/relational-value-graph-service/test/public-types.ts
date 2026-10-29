import { checkTy } from "@red-cup-engineering/relation-model-notation-typing";
import { encodeRelationalValue } from "@red-cup-engineering/relational-value-graph-service";

const encoded = encodeRelationalValue({ path: ["typed", "graph"] });
checkTy([], encoded.term, encoded.type);
