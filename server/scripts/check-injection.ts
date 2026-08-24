/**
 * The route-parameter guard, and the payload it exists to stop.
 *
 *     npx tsx scripts/check-injection.ts
 *
 * `unfriend` interpolates a route parameter into a PostgREST `.or()` filter expression that is
 * the entire WHERE clause of a `DELETE`. Until `uuidParam` existed, nothing between the wire
 * and that string checked the parameter's shape, so a value carrying filter syntax closed the
 * `and(...)` group early and added a disjunct true of every row — "delete this friendship"
 * became "delete every friendship in the project", available to any signed-in player. Verified
 * against a populated table before the fix: the benign filter matched 0 rows and the injected
 * one matched all of them.
 *
 * The guard is a shape check, so it is testable without a database or a key — which is the
 * point of this file. It runs in the same keyless sweep as the other `check-*.ts`.
 */

import assert from 'node:assert/strict';
import type { Request, Response } from 'express';

import { uuidParam } from '../src/middleware/validate.js';
import { HttpError } from '../src/middleware/errorHandler.js';

/** Runs the middleware and reports what it passed to `next`. */
function run(params: Record<string, string>, ...names: string[]): Error | null {
  let outcome: Error | null = null;

  uuidParam(...names)({ params } as unknown as Request, {} as Response, ((err?: Error) => {
    outcome = err ?? null;
  }) as never);

  return outcome;
}

const VALID = '460daac6-86a3-440a-9fe1-bf765a0022f1';

/* A well-formed id is passed straight through. */
assert.equal(run({ userId: VALID }, 'userId'), null, 'a valid uuid must pass');
assert.equal(
  run({ userId: VALID.toUpperCase() }, 'userId'),
  null,
  'uuids are hex, and hex is case-insensitive'
);

/*
 * The payload itself. Every character it needs — the parenthesis that closes the group, the
 * comma that starts a new disjunct, the dot in `id.not.is.null` — is outside a uuid's alphabet,
 * which is why a shape check is a complete answer here rather than a filter on known-bad input.
 */
const INJECTION = `${VALID}),id.not.is.null,and(requester_id.eq.${VALID}`;

const rejected = run({ userId: INJECTION }, 'userId');
assert.ok(rejected instanceof HttpError, 'the injection payload must be refused');
assert.equal(rejected.status, 404, 'a malformed id and an absent one answer the same way');

/* The pieces of it, so a narrower variant cannot slip past. */
for (const bad of [
  `${VALID})`,
  `${VALID},`,
  `${VALID}.`,
  `${VALID}"`,
  `${VALID} `,
  `${VALID}\n`,
  '',
  'search',
  '../../etc/passwd',
  `${VALID}${VALID}`,
]) {
  assert.ok(run({ userId: bad }, 'userId') instanceof HttpError, `must refuse ${JSON.stringify(bad)}`);
}

/* A missing parameter is refused rather than read as undefined further down. */
assert.ok(run({}, 'userId') instanceof HttpError, 'an absent parameter must be refused');

/* Every name is checked, not just the first. */
assert.ok(
  run({ a: VALID, b: 'nope' }, 'a', 'b') instanceof HttpError,
  'a second parameter must be checked too'
);

console.log('check-injection: ok');
