function cell(subject, predicate, object) {
  return Object.freeze({ subject, predicate, object });
}

function requireCell(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("cell must be an object");
  for (const role of ["subject", "predicate", "object"]) {
    if (!(role in value) || value[role] === undefined) throw new TypeError(`cell.${role} must be present`);
  }
  return value;
}

export function converseCell(value) {
  const { subject, predicate, object } = requireCell(value);
  return cell(object, predicate, subject);
}

export function subjectProjectionCell(value) {
  const { subject, predicate } = requireCell(value);
  return cell(subject, predicate, subject);
}

export function objectProjectionCell(value) {
  const { predicate, object } = requireCell(value);
  return cell(object, predicate, object);
}

export function specializeCell(value, specializePredicate) {
  const { subject, predicate, object } = requireCell(value);
  if (typeof specializePredicate !== "function") throw new TypeError("specializePredicate must be a function");
  return cell(subject, specializePredicate(predicate), object);
}

export const cellMoves = Object.freeze({
  converse: converseCell,
  "subject-projection": subjectProjectionCell,
  "object-projection": objectProjectionCell,
});

export function namedCellMove(name) {
  const move = cellMoves[name];
  if (!move) throw new TypeError(`unknown cell move ${JSON.stringify(name)}`);
  return move;
}
