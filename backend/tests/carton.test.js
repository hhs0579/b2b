import assert from "node:assert/strict";
import { test } from "node:test";
import { cartonCount } from "../src/domain/carton.js";

test("TEST 2 carton counts for pack of 6", () => {
  assert.equal(cartonCount(1, 6), 1);
  assert.equal(cartonCount(6, 6), 1);
  assert.equal(cartonCount(7, 6), 2);
  assert.equal(cartonCount(10, 6), 2);
  assert.equal(cartonCount(12, 6), 2);
  assert.equal(cartonCount(13, 6), 3);
});
