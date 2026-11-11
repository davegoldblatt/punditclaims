// The homepage answer is chosen by code from counts, never written by hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { answerFor, TOO_EARLY } from "../src/lib/answer.ts";

test("too few settled predictions is too early to say", () => {
  assert.equal(answerFor({ supported: 9, mixed: 0, contradicted: 0 }), TOO_EARLY);
  assert.equal(answerFor({ supported: 0, mixed: 0, contradicted: 0 }), TOO_EARLY);
});

test("the answer follows the share that came true, with mixed as half", () => {
  assert.equal(answerFor({ supported: 52, mixed: 0, contradicted: 4 }), "Mostly right.");
  assert.equal(answerFor({ supported: 7, mixed: 0, contradicted: 3 }), "More right than wrong.");
  assert.equal(answerFor({ supported: 0, mixed: 10, contradicted: 0 }), "Right about as often as wrong.");
  assert.equal(answerFor({ supported: 3, mixed: 0, contradicted: 7 }), "More wrong than right.");
  assert.equal(answerFor({ supported: 1, mixed: 0, contradicted: 9 }), "Mostly wrong.");
});
