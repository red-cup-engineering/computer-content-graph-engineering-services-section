import { createHash } from "node:crypto";

import { canonicalJson } from "@red-cup-engineering/json-services-section/canonical-json";
import { createRelationWeb, immutableJson } from "@red-cup-engineering/graph-data-service/relation-web";

import { fourProfile } from "./four-profile.mjs";

const freezeList = (values) => Object.freeze([...values]);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function present(value, label) {
  if (value === undefined) throw new TypeError(`${label} must be present`);
  return value;
}

function normalizeClaim(claim) {
  if (claim === null || typeof claim !== "object" || Array.isArray(claim)) throw new TypeError("claim must be an object");
  const normalized = {
    subject: immutableJson(present(claim.subject, "claim.subject"), "claim.subject"),
    predicate: immutableJson(present(claim.predicate, "claim.predicate"), "claim.predicate"),
    object: immutableJson(present(claim.object, "claim.object"), "claim.object"),
    polarity: claim.polarity ?? "for",
    ...(hasOwn(claim, "evidence") ? { evidence: immutableJson(claim.evidence, "claim.evidence") } : {}),
  };
  if (normalized.polarity !== "for" && normalized.polarity !== "against") throw new TypeError("claim.polarity must be \"for\" or \"against\"");
  return Object.freeze(normalized);
}

function messageIdentity(sender, claims, suppliedId) {
  if (suppliedId !== undefined) {
    if (typeof suppliedId !== "string" || suppliedId.length === 0) throw new TypeError("message.id must be a non-empty string when supplied");
    return suppliedId;
  }
  const digest = createHash("sha256").update(canonicalJson({ sender, claims })).digest("hex");
  return `urn:pam:message:sha256:${digest}`;
}

export function reifyMessage(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new TypeError("PAM input must be a message object");
  const sender = immutableJson(present(input.sender, "message.sender"), "message.sender");
  if (!Array.isArray(input.claims) || input.claims.length === 0) throw new TypeError("message.claims must be a non-empty array");
  const claims = freezeList(input.claims.map(normalizeClaim));
  return Object.freeze({ type: "pam.message", id: messageIdentity(sender, claims, input.id), sender, claims });
}

function matchTerm(pattern, key, actual) {
  return !hasOwn(pattern, key) || canonicalJson(pattern[key]) === canonicalJson(actual);
}

function assertRowOrderMarker(value, label) {
  if (value === null || typeof value !== "object" || !Number.isInteger(value.ordinal) || !Number.isInteger(value.relationIndex)) {
    throw new TypeError(`${label} must be a row (or { ordinal, relationIndex }) carrying integer ordinal and relationIndex fields`);
  }
  return value;
}

const compareRowOrder = (left, right) => (left.ordinal - right.ordinal) || (left.relationIndex - right.relationIndex);

/**
 * INTERIM: the strata<->quartet identification (asserted/saturated/settled mapped onto a
 * sigma past-cone / Delta future-cone) is an OPEN CONJECTURE, not a proven correspondence.
 * This windowing is an interim approximation and is NOT the real sigma/Delta nucleus pair —
 * that pair lives in FAE's kernel/discharge.mjs, with its extraction here deferred as Lot 9
 * work. It keys on append order (ordinal, relationIndex), not on t: Lot 1 made t an opaque
 * content-addressed witness token with no total order of its own.
 * @param {object} observation a DREW row carrying integer `ordinal`/`relationIndex`.
 * @param {{until?: object, after?: object}} [options] at most one of `until` (keep rows at or
 *   before the fence-post row) or `after` (keep rows strictly later than it).
 * @returns {boolean} whether the observation falls inside the requested window.
 */
function withinWindow(observation, { until, after } = {}) {
  if (until !== undefined && after !== undefined) throw new TypeError("windowed reading accepts only one of until or after");
  if (until !== undefined) return compareRowOrder(observation, assertRowOrderMarker(until, "until")) <= 0;
  if (after !== undefined) return compareRowOrder(observation, assertRowOrderMarker(after, "after")) > 0;
  return true;
}

/** Predicate Algebra Modeling interprets and settles observations from DREW. */
export function createPam({ profile = fourProfile, web = createRelationWeb() } = {}) {
  for (const member of ["bottom", "contribute", "join", "reading", "witness"]) {
    if (typeof profile?.[member] !== "function") throw new TypeError(`PAM profile.${member} must be a function`);
  }

  /**
   * The knowledge-join fold over observed rows. `windowOptions` is optional and, when
   * omitted, folds every observed row exactly as before (byte-identical default behavior).
   * @param {{until?: object, after?: object}} [windowOptions]
   */
  function valuation(windowOptions = {}) {
    const cells = new Map();
    for (const observation of web.query()) {
      if (!withinWindow(observation, windowOptions)) continue;
      const key = web.cellAddress(observation);
      const current = cells.get(key) ?? {
        cell: Object.freeze({ subject: observation.subject, predicate: observation.predicate, object: observation.object }),
        value: profile.bottom(),
      };
      const witness = Object.freeze({
        eventId: observation.eventId,
        ordinal: observation.ordinal,
        source: observation.source,
        relationIndex: observation.relationIndex,
        ...(hasOwn(observation, "evidence") ? { detail: observation.evidence } : {}),
      });
      cells.set(key, Object.freeze({ cell: current.cell, value: profile.join(current.value, profile.contribute(observation, witness)) }));
    }
    return cells;
  }

  const pam = {
    profile: Object.freeze({ name: profile.name ?? "unnamed-pam-profile" }),
    web,
    dispatch(input) {
      const message = reifyMessage(input);
      const observation = web.observe({ id: message.id, source: Object.freeze({ kind: "pam.message", message }), relations: message.claims });
      return Object.freeze({
        kind: "pam.dispatch-witness",
        admitted: observation.admitted,
        duplicate: observation.duplicate,
        message,
        observation,
        readings: freezeList(message.claims.map((claim) => pam.read(claim))),
      });
    },
    /**
     * @param {{until?: object, after?: object}} [options] optional row-time window: `until`
     *   folds only rows at or before the given fence-post row, `after` folds only rows
     *   strictly later than it. Omitted (the default), this folds every observed row exactly
     *   as before.
     */
    read(cell, options = {}) {
      const normalized = Object.freeze({
        subject: present(cell.subject, "cell.subject"),
        predicate: present(cell.predicate, "cell.predicate"),
        object: present(cell.object, "cell.object"),
      });
      const entry = valuation(options).get(web.cellAddress(normalized));
      const value = entry?.value ?? profile.bottom();
      return Object.freeze({
        kind: "pam.read-witness",
        cell: normalized,
        cellAddress: web.cellAddress(normalized),
        ...profile.witness(value),
        derivations: freezeList([]),
        settlement: Object.freeze({ status: "not-run", reason: "no-closure-executor" }),
      });
    },
    /**
     * @param {{until?: object, after?: object}} [options] optional row-time window, same
     *   shape as {@link read}'s; omitted, this folds every observed row exactly as before.
     */
    query(pattern = {}, options = {}) {
      const readings = [];
      for (const { cell, value } of valuation(options).values()) {
        if (!matchTerm(pattern, "subject", cell.subject)
          || !matchTerm(pattern, "predicate", cell.predicate)
          || !matchTerm(pattern, "object", cell.object)) continue;
        const witness = Object.freeze({
          kind: "pam.read-witness",
          cell,
          cellAddress: web.cellAddress(cell),
          ...profile.witness(value),
          derivations: freezeList([]),
          settlement: Object.freeze({ status: "not-run", reason: "no-closure-executor" }),
        });
        if (hasOwn(pattern, "reading") && pattern.reading !== witness.reading) continue;
        readings.push(witness);
      }
      readings.sort((left, right) => left.cellAddress.localeCompare(right.cellAddress));
      return freezeList(readings);
    },
    /** Reindexing is valuation precomposition: the view reads v(move(cell)). */
    reindex(move, { name = move.name || "anonymous-cell-move" } = {}) {
      if (typeof move !== "function") throw new TypeError("PAM reindex move must be a function");
      return Object.freeze({
        kind: "pam.reindexed-view",
        name,
        read(requestedCell) {
          const sourceCell = move(requestedCell);
          return Object.freeze({
            kind: "pam.reindexed-read-witness",
            move: name,
            requestedCell: Object.freeze({ ...requestedCell }),
            sourceCell,
            witness: pam.read(sourceCell),
          });
        },
      });
    },
    neighbors(term, { direction = "both", predicate } = {}) {
      if (!["incoming", "outgoing", "both"].includes(direction)) throw new TypeError("direction must be incoming, outgoing, or both");
      const restriction = predicate === undefined ? {} : { predicate };
      return Object.freeze({
        kind: "pam.neighborhood-witness",
        term,
        incoming: direction === "outgoing" ? freezeList([]) : pam.query({ object: term, ...restriction }),
        outgoing: direction === "incoming" ? freezeList([]) : pam.query({ subject: term, ...restriction }),
      });
    },
    messages: () => freezeList(web.events().filter((event) => event.source?.kind === "pam.message").map((event) => event.source.message)),
  };
  return Object.freeze(pam);
}

export function replayPam(messages, options = {}) {
  const pam = createPam(options);
  for (const message of messages) pam.dispatch(message);
  return pam;
}
