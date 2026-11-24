import "server-only";
import type { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

export function pooledDatabase(pool: Pool) {
  const db = drizzle(pool, { schema });
  db.transaction = async (work, config) => {
    const client = await pool.connect();
    let reusable = false;
    let callbackCompleted = false;
    let callbackFailure: Error | undefined;
    try {
      // Drizzle manages BEGIN, savepoints and completion on this one client.
      // Only this outer scope owns its pool checkout.
      const result = await drizzle(client, { schema }).transaction(async tx => {
        try {
          const value = await work(tx);
          callbackCompleted = true;
          return value;
        } catch (cause) {
          callbackFailure = new Error("Transaction callback failed", { cause });
          throw callbackFailure;
        }
      }, config);
      reusable = true;
      return result;
    } catch (error) {
      if (callbackFailure) {
        // Drizzle rethrows the callback error only after ROLLBACK succeeds.
        if (error === callbackFailure) {
          reusable = true;
          throw callbackFailure.cause;
        }
        throw new AggregateError([callbackFailure.cause, error], "Transaction rollback failed");
      }
      if (callbackCompleted) {
        throw new Error("Commit outcome unconfirmed. Reconcile before retrying.", { cause: error });
      }
      throw error;
    } finally {
      client.release(!reusable);
    }
  };
  return db;
}
