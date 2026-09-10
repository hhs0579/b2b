import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";

test("GET /api/health reports database status", async (t) => {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  });

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/health`);
  const body = await response.json();

  assert.equal(body.service, "b2b-backend");
  assert.ok(body.database === "connected" || body.database === "disconnected");

  if (body.ok) {
    assert.equal(response.status, 200);
    assert.equal(body.database, "connected");
    assert.equal(typeof body.environment, "string");
  } else {
    assert.equal(response.status, 503);
    assert.equal(body.database, "disconnected");
  }
});

test("unknown route returns unified error payload", async (t) => {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  });

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/does-not-exist`);
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "NOT_FOUND");
  assert.equal(typeof body.error.message, "string");
});

after(async () => {
  await pool.end();
});
