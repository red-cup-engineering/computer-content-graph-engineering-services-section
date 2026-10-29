import { makeNiUri, niUriDigestBytes } from "@red-cup-engineering/computer-system-engine/identity/index";

import { canonicalJson, createGraph, toJson } from "./graph.mjs";

function sha256Hex(bytes) {
  return niUriDigestBytes(makeNiUri(bytes)).toString("hex");
}

const freezeList = (values) => Object.freeze([...values]);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function present(value, label) {
  if (value === undefined) throw new TypeError(`${label} must be present`);
  return value;
}

export function immutableJson(value, label = "value") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map((item, index) => immutableJson(item, `${label}[${index}]`)));
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const copy = {};
    for (const [key, item] of Object.entries(value)) copy[key] = immutableJson(item, `${label}.${key}`);
    return Object.freeze(copy);
  }
  throw new TypeError(`${label} must be a JSON value`);
}

export const termKey = (term) => canonicalJson(immutableJson(present(term, "term"), "term"));
export const relationKey = ({ subject, predicate, object }) => canonicalJson([
  present(subject, "relation.subject"),
  present(predicate, "relation.predicate"),
  present(object, "relation.object"),
]);

export const occurrenceKey = (eventId, relationIndex) =>
  `${eventId}#relation=${relationIndex}`;

function normalizeRelation(relation) {
  if (relation === null || typeof relation !== "object" || Array.isArray(relation)) throw new TypeError("relation observation must be an object");
  const normalized = {
    subject: immutableJson(present(relation.subject, "relation.subject"), "relation.subject"),
    predicate: immutableJson(present(relation.predicate, "relation.predicate"), "relation.predicate"),
    object: immutableJson(present(relation.object, "relation.object"), "relation.object"),
    ...(hasOwn(relation, "datum") ? { datum: immutableJson(relation.datum, "relation.datum") } : {}),
    ...(hasOwn(relation, "polarity") ? { polarity: immutableJson(relation.polarity, "relation.polarity") } : {}),
    ...(hasOwn(relation, "evidence") ? { evidence: immutableJson(relation.evidence, "relation.evidence") } : {}),
  };
  return Object.freeze(normalized);
}

function batchIdentity(source, admission, relations, suppliedId) {
  if (suppliedId !== undefined) {
    if (typeof suppliedId !== "string" || suppliedId.length === 0) throw new TypeError("observation batch id must be a non-empty string when supplied");
    return suppliedId;
  }
  const digest = sha256Hex(Buffer.from(canonicalJson({ source, admission, relations }), "utf8"));
  return `urn:drew:observation:sha256:${digest}`;
}

export function observationBatch(input, ordinal = 0) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new TypeError("DREW observation input must be an object");
  const source = immutableJson(present(input.source, "observation.source"), "observation.source");
  const admission = immutableJson(input.admission ?? { status: "admitted" }, "observation.admission");
  if (admission === null || typeof admission !== "object" || !["admitted", "refused"].includes(admission.status)) {
    throw new TypeError("observation.admission.status must be admitted or refused");
  }
  const supplied = input.relations ?? input.claims ?? [];
  if (!Array.isArray(supplied)) throw new TypeError("observation.relations must be an array");
  if (admission.status === "refused" && supplied.length > 0) throw new TypeError("refused observation batches cannot carry relations");
  const relations = freezeList(supplied.map(normalizeRelation));
  return Object.freeze({
    type: "drew.observation-batch",
    id: batchIdentity(source, admission, relations, input.id),
    ordinal,
    source,
    admission,
    relations,
  });
}

function matchTerm(pattern, key, actual) {
  return !hasOwn(pattern, key) || canonicalJson(pattern[key]) === canonicalJson(actual);
}

/** Directed Relation Entity Web: observed relations, without algebraic settlement. */
export function createRelationWeb({ events = [], identity = {} } = {}) {
  const identityName = identity.name ?? "canonical-json/v1";
  const identityKey = identity.key ?? termKey;
  if (typeof identityName !== "string" || identityName.length === 0) throw new TypeError("DREW identity.name must be a non-empty string");
  if (typeof identityKey !== "function") throw new TypeError("DREW identity.key must be a function");
  const idOf = (term) => {
    const id = identityKey(term);
    if (typeof id !== "string" || id.length === 0) throw new TypeError("DREW identity.key must return a non-empty string");
    return id;
  };
  const log = [];
  const eventById = new Map();
  const observations = [];

  function apply(event) {
    if (event.admission?.status === "refused" && event.relations?.length > 0) throw new TypeError("refused observation batches cannot carry relations");
    const existing = eventById.get(event.id);
    if (existing !== undefined) {
      if (canonicalJson([existing.source, existing.admission, existing.relations])
        !== canonicalJson([event.source, event.admission, event.relations])) {
        throw new Error(`DREW observation id ${JSON.stringify(event.id)} already names different content`);
      }
      return false;
    }
    if (event.type !== "drew.observation-batch" || !Array.isArray(event.relations)) throw new TypeError("DREW replay accepts only drew.observation-batch events");
    eventById.set(event.id, event);
    log.push(event);
    event.relations.forEach((relation, relationIndex) => observations.push(Object.freeze({
      kind: "drew.relation-observation",
      address: occurrenceKey(event.id, relationIndex),
      eventId: event.id,
      ordinal: event.ordinal,
      source: event.source,
      relationIndex,
      ...relation,
    })));
    return true;
  }

  const drew = {
    observe(input) {
      const event = observationBatch(input, log.length);
      const admitted = apply(event);
      return Object.freeze({ kind: "drew.observation-witness", admitted, duplicate: !admitted, event });
    },
    refuse({ source, refusal, id }) {
      return drew.observe({
        source,
        admission: Object.freeze({ status: "refused", refusal: immutableJson(refusal, "refusal") }),
        relations: [],
        ...(id === undefined ? {} : { id }),
      });
    },
    query(pattern = {}) {
      const found = observations.filter((observation) =>
        matchTerm(pattern, "subject", observation.subject)
        && matchTerm(pattern, "predicate", observation.predicate)
        && matchTerm(pattern, "object", observation.object));
      found.sort((left, right) => relationKey(left).localeCompare(relationKey(right))
        || left.ordinal - right.ordinal || left.relationIndex - right.relationIndex);
      return freezeList(found);
    },
    /** Canonical occurrence web: one observation entity with three explicit role links. */
    graph() {
      const graph = createGraph();
      for (const observation of observations) {
        const occurrence = `urn:drew:occurrence:${observation.address}`;
        graph.addNode(occurrence, Object.freeze({ kind: "relation-occurrence", observation }));
        const roles = [
          ["subject", observation.subject],
          ["predicate", observation.predicate],
          ["object", observation.object],
        ];
        for (const [role, term] of roles) {
          const id = idOf(term);
          graph.addNode(id, Object.freeze({ kind: "term", identityPolicy: identityName, term }));
          graph.addEdge({ from: occurrence, to: id, kind: role });
        }
      }
      return graph;
    },
    /** Navigation projection only; this is not a relation-occurrence or composition model. */
    edgeProjection() {
      const graph = createGraph();
      for (const observation of observations) {
        const from = idOf(observation.subject);
        const to = idOf(observation.object);
        graph.addNode(from, Object.freeze({ kind: "term", identityPolicy: identityName, term: observation.subject }));
        graph.addNode(to, Object.freeze({ kind: "term", identityPolicy: identityName, term: observation.object }));
        graph.addEdge({ from, to, kind: idOf(observation.predicate), data: Object.freeze({ occurrence: observation.address }) });
      }
      return graph;
    },
    snapshot() {
      return Object.freeze({
        kind: "drew.snapshot",
        identityPolicy: identityName,
        web: toJson(drew.graph()),
        edgeProjection: toJson(drew.edgeProjection()),
        eventCount: log.length,
        observationCount: observations.length,
      });
    },
    neighbors(term, { direction = "both", predicate } = {}) {
      if (!["incoming", "outgoing", "both"].includes(direction)) throw new TypeError("direction must be incoming, outgoing, or both");
      const restriction = predicate === undefined ? {} : { predicate };
      return Object.freeze({
        kind: "drew.neighborhood-observation",
        term,
        incoming: direction === "outgoing" ? freezeList([]) : drew.query({ object: term, ...restriction }),
        outgoing: direction === "incoming" ? freezeList([]) : drew.query({ subject: term, ...restriction }),
      });
    },
    cellAddress(cell) {
      return canonicalJson([
        idOf(present(cell.subject, "cell.subject")),
        idOf(present(cell.predicate, "cell.predicate")),
        idOf(present(cell.object, "cell.object")),
      ]);
    },
    identity: Object.freeze({ name: identityName, key: identityKey }),
    events: () => freezeList(log),
  };

  for (const event of events) {
    if (event?.type !== "drew.observation-batch") throw new TypeError("DREW replay accepts only drew.observation-batch events");
    apply(observationBatch({
      id: event.id,
      source: event.source,
      admission: event.admission,
      relations: event.relations,
    }, event.ordinal ?? log.length));
  }
  return Object.freeze(drew);
}

export const replayRelationWeb = (events) => createRelationWeb({ events });
