// Bounded service benchmark. All data and credentials are local to this process.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { decideRoomScore } from "@/lib/tournament/score-review";
import { staffWorkspace } from "@/lib/tournament/staff-workspace";
import { spectatorView } from "@/lib/tournament/spectator";
import { scoringFixture } from "./score-submission-fixture";

const pg = new PGlite();
const db = drizzle(pg, { schema });
let peak = process.memoryUsage.rss();
const startRss = peak;
async function batch(name: string, count: number, task: (index: number) => Promise<unknown>) {
  const times: number[] = [];
  let errors = 0;
  for (let start = 0; start < count; start += 4) {
    await Promise.all(Array.from({ length: Math.min(4, count - start) }, async (_, i) => {
      const begin = performance.now();
      try { await task(start + i); }
      catch (error) { errors++; console.error(name, error instanceof Error ? error.name : "failure"); }
      times.push(performance.now() - begin);
      peak = Math.max(peak, process.memoryUsage.rss());
    }));
  }
  times.sort((a,b) => a-b);
  const percentile = (p: number) => Math.round(times[Math.ceil(p * times.length) - 1]);
  console.log({name, count, concurrency:4, p50ms:percentile(.5), p95ms:percentile(.95), maxMs:percentile(1), errors});
  assert.equal(errors, 0);
}
try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  const f = await scoringFixture(db, "championship");
  const [owner] = await db.select({ userId:schema.tournaments.ownerId }).from(schema.tournaments).where(eq(schema.tournaments.id,f.id));
  const host = { ...owner, role:"host" as const, name:"Load fixture host" };
  await db.insert(schema.tournamentRoomStaff).values({ tournamentId:f.id, roomId:"hall", userId:host.userId, role:"room_host" });
  const ids: string[] = [];
  await batch("submit", 6, async i => {
    const receipt = await f.submit({...f.data,teamId:f.teams[i % 2].id,questionKey:["q-a","q-b","q-c"][Math.floor(i/2)],clientRequestId:randomUUID()});
    assert.equal(receipt.created,true);
    ids[i] = receipt.scoreId;
  });
  await batch("review", 6, i => decideRoomScore(f.adapter,f.id,"hall",host,{scoreId:ids[i],decision:"approve"}));
  await batch("public standings", 32, async i => {
    const view = await spectatorView(f.adapter,f.id,"standings",i%2 ? "hall" : undefined);
    assert.equal(view.tables[0].rows.find(r=>r.name==="A")?.total,6);
    assert.equal(view.tables[0].rows.find(r=>r.name==="B")?.total,6);
  });
  await batch("judge workspace", 24, i => staffWorkspace(f.adapter,f.id,"hall",f.judges[i%2],"judge"));
  assert.equal((await db.select().from(schema.tournamentScoreEvents)).length,12);
} finally {
  const start = performance.now();
  await pg.close();
  console.log({initialRssMiB:Math.round(startRss/1048576), sampledPeakRssMiB:Math.round(peak/1048576), shutdownMs:Math.round(performance.now()-start)});
}
