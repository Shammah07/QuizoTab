import "server-only";
import { eq } from "drizzle-orm";
import { ApiError } from "@/lib/api";
import type { Db } from "@/lib/db";
import { tournaments } from "@/lib/db/schema";

export async function lockedEngine(tx:Db,id:string) {
  const [row]=await tx.select({engine:tournaments.scoringEngineVersion}).from(tournaments)
    .where(eq(tournaments.id,id)).for("update");
  if (!row) throw new ApiError(404,"Tournament not found.");
  return row.engine;
}

export async function withLegacyScoring<T>(db:Db,id:string,work:(tx:Db)=>Promise<T>) {
  return db.transaction(async tx=>{
    if(await lockedEngine(tx,id)!=="legacy") throw new ApiError(409,"Use the assigned room workspace for scoring.");
    return work(tx);
  });
}
