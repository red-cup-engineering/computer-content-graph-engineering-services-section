import { identify as rowId } from "@red-cup-engineering/eavt";
import { canonicalJson as canonicalKey } from "@red-cup-engineering/computer-data-engine/identity";
import {
  EMPTY_WITNESS_ROOT,
  IDENTITY_SETTLEMENT_PROFILE,
  identifyBytesSemanticContent,
  identifyJsonSemanticContent,
} from "@red-cup-engineering/relation-model-notation/runtime";
import { articulate, mark, utterance } from "@red-cup-engineering/computer-data-engine/utterance";
import {
  predicate,
  presentPredicationSite,
  foldIndependentEvidence,
  rowId as independentEvidenceRowId,
  sectionSpace,
} from "@lenticule-science/metrologic/articulation/predicating";
import {
  ARTICULATING_APEX,
  executeArticulateUtterance,
} from "@lenticule-science/articulating-language-cone-service";
import { readMarkdownDocument } from "@red-cup-engineering/markdown-engineering-services-section/read-markdown-document";
import { createGraph } from "@red-cup-engineering/graph-data-service";
import { admitSchema, validateSchemaInstance } from "@red-cup-engineering/json-schema-services-section";
import { valueOf } from "@red-cup-engineering/computer-data-engine/bilattice-charge";
import { row as chuRow, settleRow } from "@red-cup-engineering/computer-data-engine/linear-logic-chu";
import { isNiUri as isCanonicalSha256NiUri } from "@red-cup-engineering/computer-data-engine/identity";
export { projectWorkspaceContentGraphTyped, workspaceResourceDescriptorType } from "./workspace-thing-catalog.mjs";
const DEPENDENCY_FIELDS = Object.freeze(["dependencies", "optionalDependencies", "peerDependencies"]);

function text(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function path(value) {
  const normalized = text(value, "resource.path").replaceAll("\\", "/").replace(/^\.\//u, "");
  if (normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../") || normalized.includes("\0")) {
    throw new TypeError(`resource.path escapes the workspace: ${value}`);
  }
  return normalized;
}

function identify(objectKind, value) {
  return identifyJsonSemanticContent({
    objectKind,
    value: JSON.parse(JSON.stringify(value)),
    witnessRoot: EMPTY_WITNESS_ROOT,
  });
}

function exactNi(value, label) {
  if (!isCanonicalSha256NiUri(value)) throw new TypeError(`${label} must be a canonical SHA-256 ni identifier`);
  return value;
}

function freeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function artifact(pathname, content) {
  const bytes = Buffer.from(content, "utf8");
  return Object.freeze({ path: pathname, bytes: bytes.length, ni: identifyBytesSemanticContent({ objectKind: "workspace-content-graph.file", bytes, witnessRoot: EMPTY_WITNESS_ROOT }).token });
}

function rootEntrypoints(manifest) {
  const root = typeof manifest.exports === "string" ? manifest.exports : manifest.exports?.["."];
  const candidates = [];
  if (typeof root === "string") candidates.push(root);
  else if (root !== null && typeof root === "object" && !Array.isArray(root)) {
    for (const key of ["import", "default", "node", "require"]) if (typeof root[key] === "string") candidates.push(root[key]);
  }
  if (candidates.length === 0 && typeof manifest.main === "string") candidates.push(manifest.main);
  return [...new Set(candidates)];
}

function contract(manifest) {
  const declared = manifest.semiotic;
  if (declared === null || typeof declared !== "object" || Array.isArray(declared)) {
    return Object.freeze({ disposition: "undeclared", operation: null, precondition: null, postcondition: null });
  }
  return Object.freeze({
    disposition: "declared",
    operation: text(declared.operation, `${manifest.name}.semiotic.operation`),
    precondition: text(declared.precondition, `${manifest.name}.semiotic.precondition`),
    postcondition: text(declared.postcondition, `${manifest.name}.semiotic.postcondition`),
  });
}

function owningPackage(packages, pathname) {
  return packages
    .filter(({ directory }) => directory === "" || pathname.startsWith(`${directory}/`))
    .sort((left, right) => right.directory.length - left.directory.length)[0] ?? null;
}

function schemaReferences(value, found = []) {
  if (Array.isArray(value)) for (const item of value) schemaReferences(item, found);
  else if (value !== null && typeof value === "object") for (const [key, item] of Object.entries(value)) {
    if (key === "$ref" && typeof item === "string") found.push(item);
    else schemaReferences(item, found);
  }
  return found;
}

function stringList(value) {
  if (typeof value === "string" && value.trim() !== "") return Object.freeze([value.trim()]);
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze([...new Set(value.filter((item) => typeof item === "string" && item.trim() !== "").map((item) => item.trim()))]);
}

function glossaryTermReadouts(resource) {
  if (resource.kind === "json" && resource.value !== null && typeof resource.value === "object" && !Array.isArray(resource.value)) {
    const { id, name, definition } = resource.value;
    if (typeof id !== "string" || id.trim() === "" || typeof name !== "string" || name.trim() === "" || typeof definition !== "string" || definition.trim() === "") return Object.freeze([]);
    return Object.freeze([Object.freeze({ id: id.trim(), name: name.trim(), token: name.trim(), definition: definition.trim(), carrierKind: "json", instance: resource.value })]);
  }
  if (resource.kind !== "markdown" || resource.document.frontmatter.type !== "term") return Object.freeze([]);
  const tokens = stringList(resource.document.frontmatter.defines);
  const body = resource.document.body.trim();
  const description = resource.document.frontmatter.description;
  const definition = body !== "" ? body : typeof description === "string" ? description.trim() : "";
  if (tokens.length === 0 || definition === "") return Object.freeze([]);
  const declaredName = resource.document.frontmatter.name;
  return Object.freeze(tokens.map((token) => {
    const id = token.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
    const name = typeof declaredName === "string" && declaredName.trim() !== "" ? declaredName.trim() : token;
    return Object.freeze({ id, name, token, definition, carrierKind: "markdown", instance: Object.freeze({ id, name, definition }) });
  }));
}

function frontmatterClaimCarriers(resource) {
  if (resource.kind !== "markdown" || resource.document.format === null) return Object.freeze([]);
  // `projectMarkdownAssertions` appends the prose body after every frontmatter
  // assertion. Keep its already-normalized frontmatter projection, including a
  // legitimately authored `body:` key, by dropping only that final assertion.
  const assertions = resource.document.assertions.slice(0, -1);
  return Object.freeze(assertions.map((assertion, ordinal) => {
    const sourceWitness = Object.freeze({
      kind: "workspace.frontmatter-source-witness",
      version: 1,
      resourcePath: resource.path,
      carrierBytesNi: resource.source.ni,
      carrierSemanticNi: resource.identity.token,
      frontmatterAssertionOrdinal: ordinal,
    });
    // This is deliberately the exact four-field row accepted by
    // @561-group/computer's EAVT substrate. The row is a positive assertion;
    // negative evidence would be a separately admitted independent witness on
    // this same oriented claim, never a converse relation or polarity field.
    const eavt = Object.freeze({
      e: resource.path,
      a: assertion.a,
      v: assertion.v,
      t: Object.freeze({
        kind: "predication.independent-evidence",
        version: 1,
        side: "positive",
        by: resource.source.ni,
        witness: sourceWitness,
      }),
    });
    const body = Object.freeze({
      kind: "workspace.frontmatter-claim.carrier",
      version: 1,
      subject: eavt.e,
      predicate: eavt.a,
      object: eavt.v,
      sourceWitness,
      evidenceCoordinates: Object.freeze({
        positive: Object.freeze([resource.source.ni]),
        negative: Object.freeze([]),
      }),
      eavt,
      correspondence: Object.freeze({
        disposition: "unsettled",
        identity: "frontmatter keys and values are preserved without alias normalization",
        negativeEvidence: "no converse predicate or negative evidence is derived",
        settling: "no FOUR fold or settling operation is performed",
        sheafification: "no sheaf operation is performed",
      }),
    });
    return Object.freeze({ id: identify("workspace.frontmatter-claim", body).token, ...body });
  }));
}

/**
 * Feature-detect and fold independently witnessed frontmatter claims.
 * The result assesses only the evidence present in this graph. It does not
 * verify witness signatures, project L-Space, or perform sheafification.
 */
export function projectWorkspaceFrontmatterClaimSections(graph) {
  if (graph === null || typeof graph !== "object" || Array.isArray(graph)) throw new TypeError("WorkspaceContentGraph must be an object");
  if (!Object.hasOwn(graph, "frontmatterClaims")) return null;
  if (!Array.isArray(graph.frontmatterClaims)) throw new TypeError("WorkspaceContentGraph.frontmatterClaims must be an array when present");
  const claims = graph.frontmatterClaims.map((claim, index) => {
    const label = `WorkspaceContentGraph.frontmatterClaims[${index}]`;
    if (claim?.kind !== "workspace.frontmatter-claim.carrier" || claim.version !== 1) throw new TypeError(`${label} is not a frontmatter claim carrier v1`);
    exactNi(claim.id, `${label}.id`);
    const { id, ...body } = claim;
    if (identify("workspace.frontmatter-claim", body).token !== id) throw new Error(`${label} differs from its addressed carrier`);
    const sourceWitness = claim.sourceWitness;
    if (sourceWitness?.kind !== "workspace.frontmatter-source-witness" || sourceWitness.version !== 1
      || !Number.isInteger(sourceWitness.frontmatterAssertionOrdinal) || sourceWitness.frontmatterAssertionOrdinal < 0) {
      throw new TypeError(`${label}.sourceWitness is malformed`);
    }
    text(sourceWitness.resourcePath, `${label}.sourceWitness.resourcePath`);
    exactNi(sourceWitness.carrierBytesNi, `${label}.sourceWitness.carrierBytesNi`);
    exactNi(sourceWitness.carrierSemanticNi, `${label}.sourceWitness.carrierSemanticNi`);
    if (claim.subject !== claim.eavt?.e || claim.predicate !== claim.eavt?.a || canonicalKey(claim.object) !== canonicalKey(claim.eavt?.v)) {
      throw new Error(`${label} changes claim orientation between carrier and EAVT row`);
    }
    const transaction = claim.eavt?.t;
    if (transaction?.kind !== "predication.independent-evidence" || transaction.version !== 1
      || !["positive", "negative"].includes(transaction.side) || transaction.by !== sourceWitness.carrierBytesNi
      || canonicalKey(transaction.witness) !== canonicalKey(sourceWitness)) {
      throw new TypeError(`${label}.eavt.t is not an independent source witness v1`);
    }
    const expectedCoordinates = transaction.side === "positive"
      ? { positive: [transaction.by], negative: [] }
      : { positive: [], negative: [transaction.by] };
    if (canonicalKey(claim.evidenceCoordinates) !== canonicalKey(expectedCoordinates)) throw new Error(`${label}.evidenceCoordinates do not match its witnessed side`);
    return claim;
  });

  const sections = [];
  for (const subject of [...new Set(claims.map(({ subject }) => subject))].sort()) {
    const subjectClaims = claims.filter((claim) => claim.subject === subject);
    const pointClaims = [...new Map(subjectClaims.map(({ predicate, object }) => [canonicalKey([predicate, object]), { subject, predicate, object }])).values()];
    const rows = subjectClaims.map(({ eavt }) => eavt);
    const folded = foldIndependentEvidence(subject, pointClaims, rows);
    const { space, cellFor } = sectionSpace(folded, rows);
    // Articulating folds evidence under its JCS-hex row identity. This public
    // EAVT projection names the same rows by EAVT's canonical-CBOR NI identity.
    const eavtRowIdByFoldRowId = new Map(rows.map((row) => [independentEvidenceRowId(row), rowId(row)]));
    const sourceWitnessByRowId = new Map(subjectClaims.map((claim) => [independentEvidenceRowId(claim.eavt), claim.sourceWitness]));
    for (const point of space.points) {
      const cell = cellFor(point);
      const [positiveFoldRowIds, negativeFoldRowIds] = cell.charge.evidence;
      const positiveRowIds = positiveFoldRowIds.map((id) => eavtRowIdByFoldRowId.get(id));
      const negativeRowIds = negativeFoldRowIds.map((id) => eavtRowIdByFoldRowId.get(id));
      sections.push(freeze({
        type: "WorkspaceFrontmatterClaimSection",
        version: 1,
        subject,
        predicate: cell.predicate,
        object: cell.object,
        settled: valueOf(settleRow(space, point)).name,
        evidenceRowIds: { positive: [...positiveRowIds], negative: [...negativeRowIds] },
        sourceWitnesses: {
          positive: positiveFoldRowIds.map((id) => sourceWitnessByRowId.get(id)),
          negative: negativeFoldRowIds.map((id) => sourceWitnessByRowId.get(id)),
        },
        chuRead: { point, cells: chuRow(space, point).map(({ state, charge }) => ({ state, value: valueOf(charge).name })) },
        correspondence: {
          scope: "one admitted WorkspaceContentGraph carrier",
          authority: "source witnesses are retained but not signature-verified",
          lSpace: "not projected",
          sheafification: "not performed",
        },
      }));
    }
  }
  return freeze({
    type: "WorkspaceFrontmatterClaimSectionProjection",
    version: 1,
    carrierKind: "workspace.frontmatter-claim.carrier",
    carrierVersion: 1,
    sections,
  });
}

function articulateGlossaryTerm(resource, readout, termSchemaNi, schemaValidation) {
  const termBody = Object.freeze({
    type: "GlossaryTerm",
    version: 1,
    id: readout.id,
    name: readout.name,
    token: readout.token,
    definition: readout.definition,
  });
  const termNi = identify("glossary.term", termBody).token;
  const articulation = executeArticulateUtterance({ apex: ARTICULATING_APEX, tokenMark: readout.token, claimMark: readout.definition });
  const predicationGenerators = presentPredicationSite(predicate(articulate(utterance(mark(readout.token), mark(readout.definition)))));
  const predicationGeneratorsNi = identify("predication.site.generators", predicationGenerators).token;
  const admissionBody = Object.freeze({
    kind: "glossary.term.admission",
    version: 1,
    carrierKind: readout.carrierKind,
    carrierSemanticNi: resource.identity.token,
    carrierBytesNi: resource.source.ni,
    schemaNi: termSchemaNi,
    schemaValidation,
    termNi,
  });
  const admissionNi = identify("glossary.term.admission", admissionBody).token;
  const readoutBody = Object.freeze({
    kind: "workspace.glossary-utterance-readout",
    version: 1,
    apex: ARTICULATING_APEX,
    termNi,
    forward: Object.freeze([
      Object.freeze({ morphism: "admit-carrier", domain: resource.source.ni, codomain: admissionNi }),
      Object.freeze({ morphism: "read-typed-term", domain: admissionNi, codomain: termNi }),
      Object.freeze({ morphism: "execute-node-articulation", domain: termNi, codomain: articulation.id }),
      Object.freeze({ morphism: "present-predication-generators", domain: articulation.id, codomain: predicationGeneratorsNi }),
    ]),
    backward: Object.freeze([
      Object.freeze({ demand: "carrier-bytes-preserved", witness: resource.source.ni }),
      Object.freeze({ demand: "term-schema-admitted", witness: termSchemaNi }),
      Object.freeze({ demand: "token-and-claim-present", witness: articulation.requestNi }),
      Object.freeze({ demand: "articulating-apex-bound", witness: ARTICULATING_APEX }),
    ]),
    articulationReceiptNi: articulation.id,
    predicationGeneratorsNi,
    correspondence: Object.freeze({
      disposition: "obstructed",
      nodeLeanArticulation: "node-potential-cell-transports-the-exact-token-with-an-empty-claim-slot",
      curryHowardLambek: "no-glossary-prose-to-typed-term-derivation-or-cone-map-is-implemented",
      orientation: "articulate-then-predicate-produces-only-the-reflexive-predication-generator",
      positing: "no-positive-or-negative-evidence-source-is-present",
      settling: "no-settling-operation-is-performed",
      refutation: "no-proof-relevant-counterchallenge-to-negative-slot-morphism-is-implemented",
    }),
  });
  const readoutNi = identify("workspace.glossary-utterance-readout", readoutBody).token;
  return Object.freeze({
    id: readoutNi,
    ...readoutBody,
    term: termBody,
    admission: Object.freeze({ id: admissionNi, ...admissionBody }),
    articulation,
    predicationGenerators,
  });
}

/**
 * Read package apexes, JSON Schemas, and Markdown as one addressed actor/content
 * territory. Acquisition remains outside this pure boundary: callers supply
 * the exact resources they observed, and every edge retains its witness.
 */
export function catalogWorkspaceContentGraph({ resources } = {}) {
  if (!Array.isArray(resources) || resources.length === 0) throw new TypeError("resources must be a non-empty observed workspace set");
  const admitted = resources.map((resource, index) => {
    if (resource === null || typeof resource !== "object" || Array.isArray(resource)) throw new TypeError(`resources[${index}] must be an object`);
    const pathname = path(resource.path), content = text(resource.content, `resources[${index}].content`), source = artifact(pathname, content);
    if (pathname.endsWith("package.json")) {
      let value;
      try { value = JSON.parse(content); } catch (error) { throw new TypeError(`${pathname} is not JSON: ${error.message}`); }
      text(value.name, `${pathname}.name`); text(value.version, `${pathname}.version`);
      const identity = identify("npm.package-manifest", value);
      return Object.freeze({ kind: "package-manifest", path: pathname, source, value, identity });
    }
    if (pathname.endsWith(".json")) {
      let value;
      try { value = JSON.parse(content); } catch { return Object.freeze({ kind: "json", path: pathname, source, value: content, identity: identify("content.json-text", { path: pathname, content }) }); }
      const isSchema = typeof value?.$schema === "string" || typeof value?.$id === "string" || pathname.endsWith(".schema.json");
      const identity = identify(isSchema ? "content.json-schema" : "content.json", value);
      return Object.freeze({ kind: isSchema ? "json-schema" : "json", path: pathname, source, value, identity });
    }
    if (/\.(?:md|mdown|markdown)$/iu.test(pathname)) {
      const document = readMarkdownDocument(content);
      const value = Object.freeze({ path: pathname, content });
      return Object.freeze({ kind: "markdown", path: pathname, source, value, document, identity: identify("content.markdown-document", document) });
    }
    const value = Object.freeze({ path: pathname, content });
    return Object.freeze({ kind: "text", path: pathname, source, value, identity: identify("content.text", value) });
  });

  const packages = admitted.filter(({ kind }) => kind === "package-manifest").map((resource) => {
    const manifest = resource.value, directory = resource.path.slice(0, -"package.json".length).replace(/\/$/u, "");
    const entrypoints = rootEntrypoints(manifest), declaredContract = contract(manifest);
    const body = Object.freeze({
      type: "PackageActorApex",
      version: 1,
      actor: `urn:npm:${manifest.name}`,
      name: manifest.name,
      release: manifest.version,
      directory,
      manifestNi: resource.identity.token,
      apex: Object.freeze({ disposition: entrypoints.length === 1 ? "single" : entrypoints.length === 0 ? "missing" : "ambiguous", entrypoints }),
      contract: declaredContract,
    });
    return Object.freeze({ ...body, id: identify("npm.package-actor-apex", body).token });
  });

  const termSchema = admitted.find((resource) => resource.kind === "json-schema" && resource.value.$id === "emsenn/schema/term") ?? null;
  const termSchemaNi = termSchema?.identity.token ?? null;
  const admittedTermSchema = termSchema === null ? null : admitSchema({ schema: termSchema.value, allowUnknownAnnotations: true }).schema;
  const glossaryOutcomes = admitted.flatMap((resource) => glossaryTermReadouts(resource).map((readout) => {
    const validation = admittedTermSchema === null
      ? Object.freeze({ ok: false, errors: Object.freeze([Object.freeze({ pointer: "", keyword: "$schema", message: "emsenn/schema/term is absent from the observed resource set" })]) })
      : validateSchemaInstance({ instance: readout.instance, schema: admittedTermSchema });
    if (validation.ok) return articulateGlossaryTerm(resource, readout, termSchemaNi, validation);
    const body = Object.freeze({
      kind: "glossary.term.refusal",
      version: 1,
      carrierSemanticNi: resource.identity.token,
      carrierBytesNi: resource.source.ni,
      token: readout.token,
      schemaNi: termSchemaNi,
      validation,
    });
    return Object.freeze({ ...body, id: identify("glossary.term.refusal", body).token });
  }));
  const glossaryUtteranceReadouts = glossaryOutcomes.filter(({ kind }) => kind === "workspace.glossary-utterance-readout");
  const glossaryRefusals = glossaryOutcomes.filter(({ kind }) => kind === "glossary.term.refusal");
  const frontmatterClaims = Object.freeze(admitted.flatMap(frontmatterClaimCarriers));

  const relations = [];
  const relate = (subject, predicate, object, witnessIdentifiers = []) => {
    const carrier = Object.freeze({
      kind: "workspace.oriented-relation.carrier",
      version: 1,
      subject: text(subject, "relation.subject"),
      predicate: text(predicate, "relation.predicate"),
      object: text(object, "relation.object"),
      witnessIdentifiers: Object.freeze(witnessIdentifiers.map((identifier, index) => text(identifier, `relation.witnessIdentifiers[${index}]`))),
    });
    const edge = identifyJsonSemanticContent({
      objectKind: "workspace.oriented-relation",
      value: carrier,
      witnessRoot: EMPTY_WITNESS_ROOT,
    });
    if (edge.envelope.settlementProfile !== IDENTITY_SETTLEMENT_PROFILE) {
      throw new TypeError("relation identity did not use the canonical identity settlement profile");
    }
    relations.push(Object.freeze({
      id: edge.token,
      ...carrier,
    }));
  };
  for (const pkg of packages) {
    relate(pkg.id, "urn:semiotic:realizes-actor", pkg.actor, [pkg.manifestNi]);
    relate(pkg.actor, "urn:semiotic:has-apex", pkg.id, [pkg.manifestNi]);
    relate(pkg.actor, "urn:semiotic:has-single-apex", pkg.apex.disposition === "single" ? "true" : "false", [pkg.manifestNi]);
    relate(pkg.actor, "urn:semiotic:declares-hoare-contract", pkg.contract.disposition === "declared" ? "true" : "false", [pkg.manifestNi]);
    if (pkg.contract.disposition === "declared") {
      relate(pkg.actor, "urn:semiotic:performs", pkg.contract.operation, [pkg.manifestNi]);
      relate(pkg.actor, "urn:hoare:requires", pkg.contract.precondition, [pkg.manifestNi]);
      relate(pkg.actor, "urn:hoare:ensures", pkg.contract.postcondition, [pkg.manifestNi]);
    }
    for (const field of DEPENDENCY_FIELDS) for (const provider of Object.keys(admitted.find(({ identity }) => identity.token === pkg.manifestNi).value[field] ?? {}).sort()) {
      relate(pkg.actor, `urn:npm:${field}`, `urn:npm:${provider}`, [pkg.manifestNi]);
    }
  }
  for (const resource of admitted.filter(({ kind }) => kind !== "package-manifest")) {
    const owner = owningPackage(packages, resource.path);
    if (owner !== null) relate(owner.actor, "urn:semiotic:contains", resource.identity.token, [resource.source.ni]);
    if (resource.kind === "json-schema") {
      if (typeof resource.value.$id === "string") relate(resource.identity.token, "urn:json-schema:declares-id", resource.value.$id, [resource.source.ni]);
      for (const reference of [...new Set(schemaReferences(resource.value))].sort()) relate(resource.identity.token, "urn:json-schema:references", reference, [resource.source.ni]);
    }
    if (resource.kind === "markdown") for (const heading of resource.document.structure.headings) {
      if (heading.title.trim() !== "") relate(resource.identity.token, `urn:markdown:heading:${heading.level}`, heading.title, [resource.source.ni]);
    }
  }
  for (const readout of glossaryUtteranceReadouts) {
    relate(readout.admission.carrierSemanticNi, "urn:semiotic:admits", readout.termNi, [readout.admission.carrierBytesNi]);
    relate(readout.termNi, "urn:semiotic:specified-by", readout.admission.schemaNi, [readout.admission.carrierBytesNi]);
    relate(readout.termNi, "urn:glossary:defines", readout.term.token, [readout.admission.carrierBytesNi]);
    relate(readout.term.token, "urn:glossary:means", readout.term.definition, [readout.articulation.id]);
    relate(readout.termNi, "urn:semiotic:has-node-articulation-readout", readout.articulation.id, [readout.articulation.requestNi]);
    relate(readout.articulation.id, "urn:semiotic:presents-predication-generators", readout.predicationGeneratorsNi, [readout.articulation.id]);
    relate(readout.id, "urn:semiotic:has-apex", readout.apex, [readout.articulation.id]);
  }
  const glossaryOverlaps = [...Map.groupBy(glossaryUtteranceReadouts, (readout) => readout.term.token).entries()]
    .filter(([, readouts]) => new Set(readouts.map((readout) => readout.term.definition)).size > 1)
    .map(([token, readouts]) => Object.freeze({
      kind: "glossary.overlap-obstruction",
      token,
      disposition: "unresolved",
      definitions: Object.freeze(readouts.map((readout) => Object.freeze({ termNi: readout.termNi, definition: readout.term.definition, readoutNi: readout.id }))),
    }));
  relations.sort((left, right) => left.subject.localeCompare(right.subject) || left.predicate.localeCompare(right.predicate) || left.object.localeCompare(right.object));
  const body = Object.freeze({
    type: "WorkspaceContentGraph",
    // Keep the outer v3 contract: modeled-union-dimension currently admits
    // exactly that version. `frontmatterClaims` is an additive, independently
    // versioned carrier collection whose readers can feature-detect.
    version: 3,
    denominator: Object.freeze({ observedResources: admitted.length, packageActors: packages.length, frontmatterClaims: frontmatterClaims.length, glossaryUtteranceReadouts: glossaryUtteranceReadouts.length, glossaryRefusals: glossaryRefusals.length, glossaryOverlaps: glossaryOverlaps.length }),
    packages: Object.freeze(packages),
    resources: Object.freeze(admitted.map(({ value: _value, identity, ...resource }) => Object.freeze({ ...resource, semanticNi: identity.token }))),
    frontmatterClaims,
    glossaryUtteranceReadouts: Object.freeze(glossaryUtteranceReadouts),
    glossaryRefusals: Object.freeze(glossaryRefusals),
    glossaryOverlaps: Object.freeze(glossaryOverlaps),
    relations: Object.freeze(relations),
  });
  return Object.freeze({ ...body, id: identify("typed-resource-catalog.workspace-content-graph", body).token });
}

/**
 * Project a WorkspaceContentGraph's `relations` onto the shared
 * @red-cup-engineering/graph-data-service carrier: one node per distinct
 * subject/object term, one edge per relation, `kind` set to the relation's
 * predicate (or, with `kind`, restricted to relations of that one
 * predicate). This is the reusable substitute for callers walking
 * `relations` by hand to answer reachability, cycle, or ordering questions —
 * the graph carrier, not a second traversal implementation.
 */
export function projectContentGraph(workspaceContentGraph, { kind } = {}) {
  if (workspaceContentGraph === null || typeof workspaceContentGraph !== "object" || !Array.isArray(workspaceContentGraph.relations)) {
    throw new TypeError("projectContentGraph requires a WorkspaceContentGraph with a relations array");
  }
  const graph = createGraph();
  for (const relation of workspaceContentGraph.relations) {
    if (kind !== undefined && relation.predicate !== kind) continue;
    graph.addNode(relation.subject);
    graph.addNode(relation.object);
    graph.addEdge({
      from: relation.subject,
      to: relation.object,
      kind: relation.predicate,
      data: Object.freeze({ id: relation.id, witnessIdentifiers: relation.witnessIdentifiers }),
    });
  }
  return graph;
}
