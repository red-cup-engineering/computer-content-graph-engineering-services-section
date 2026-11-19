# event-stream-data-service

Small dependency-free data primitives for systems that admit records through one
writer and derive a current projection from the admitted history.  They are
deliberately neutral about record vocabulary, persistence, authentication,
transport, clocks, and domain state.

The package provides:

- `createValidatedQueue`: validate incoming values, preserve admission order,
  and hand one batch to a chosen writer.
- `createAppendOnlyLog`: keep canonicalized admitted records without exposing
  its mutable backing array.
- `createKeyedNumberedHistory`: retain a bounded per-key delta history and
  honestly report when a requested resume cursor has aged out.
- `createIncrementalProjection`: cache entries, refresh only dirty subjects,
  and create subscriber-specific changed/removed projections.
- `replayEventStream`: invoke a supplied transition once for every numbered
  step, including empty steps.

This is intentionally not an EAVT or SEAVT implementation.  It can carry EAVT,
SEAVT, text operations, game inputs, or another record form once an owning
application supplies canonicalization and domain folding.
