import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Pool } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { pooledDatabase } from "../lib/db/pooled-transactions";

// Keep the installed driver's pool and Drizzle transaction code. Substitute
// only the wire client so each protocol failure can be placed deterministically.
for (const fault of ["none", "begin", "callback", "rollback", "commit", "commit-and-rollback"]) {
  const statements: string[] = [];
  let clients = 0;
  let ended = 0;
  let releases = 0;
  let callbacks = 0;
  let inject = true;
  const callbackError = new Error("rejected by service");
  class WireClient extends EventEmitter {
    _queryable = true;
    constructor() { super(); clients++; }
    connect(done: () => void) { done(); }
    end() { ended++; }
    async query(query: { text: string }) {
      const statement = query.text.trim();
      statements.push(statement);
      const verb = statement.split(" ")[0];
      if (inject && (fault === verb || (fault === "commit-and-rollback" && ["commit", "rollback"].includes(verb)))) {
        throw new Error("Injected " + verb + " acknowledgment failure");
      }
      return { rows: [] };
    }
  }

  const pool = new Pool({ max: 1, connectionTimeoutMillis: 1000, idleTimeoutMillis: 0 });
  Object.assign(pool, { Client: WireClient });
  pool.on("release", () => { releases++; });
  const db = pooledDatabase(pool);
  try {
    const begin = "begin isolation level repeatable read read only";
    const attempt = db.transaction(async tx => {
      callbacks++;
      await tx.execute(sql`select 1`);
      if (fault === "callback" || fault === "rollback") throw callbackError;
      return 17;
    }, { isolationLevel: "repeatable read", accessMode: "read only" });

    if (fault === "none") assert.equal(await attempt, 17);
    else await assert.rejects(attempt, (error: Error) => {
      if (fault === "callback") return error === callbackError;
      if (fault === "rollback") return error instanceof AggregateError && error.errors[0] === callbackError;
      if (fault === "begin") return error.message.includes("begin");
      return error.message.includes("Commit outcome unconfirmed");
    });
    const rolledBack = ["callback", "rollback"].includes(fault);
    const committed = !rolledBack && fault !== "begin";
    assert.deepEqual(statements, [begin, ...(fault === "begin" ? [] : ["select 1"]),
      ...(committed ? ["commit"] : []), ...(fault !== "none" && fault !== "begin" ? ["rollback"] : [])]);
    assert.equal(callbacks, fault === "begin" ? 0 : 1);
    const removed = fault !== "none" && fault !== "callback";
    assert.equal(ended, Number(removed));
    assert.equal(clients, 1);
    assert.equal(releases, 1);
    assert.equal(pool.totalCount, Number(!removed));
    assert.equal(pool.idleCount, pool.totalCount);

    inject = false;
    assert.equal(await db.transaction(tx => tx.transaction(async () => 23)), 23);
    assert.deepEqual(statements.slice(-4), ["begin", "savepoint sp1", "release savepoint sp1", "commit"]);
    assert.equal(clients, removed ? 2 : 1);
    assert.equal(releases, 2);
    assert.equal(pool.idleCount, 1);
    console.log("ok  pooled transaction cleanup and subsequent checkout:", fault);
  } finally {
    await pool.end();
  }
}
