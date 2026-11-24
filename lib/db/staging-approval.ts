import {createHash} from "node:crypto";
import {z} from "zod";
import {readPins} from "./pilot-target";

// Add only a separately reviewed control-plane identity and fixture digest.
// No real staging project or fixture has been approved yet.
export const approvedStagingFixtures: readonly string[] = [];

const approval = z.strictObject({
  purpose:z.literal("synthetic-staging-acceptance"), pins:z.unknown(),
  origin:z.url(), project:z.string().regex(/^prj_[A-Za-z0-9_]+$/),
  tournament:z.uuid(), spectators:z.union([z.literal(30),z.literal(60)]),
});

export function describeStagingFixture(raw:unknown) {
  const plan=approval.parse(raw);
  const pins=readPins(plan.pins);
  const url=new URL(plan.origin);
  if(url.protocol!=="https:" || url.origin!==plan.origin ||
     pins.projectId==="noisy-violet-99522280" || pins.branchId==="br-restless-king-bdli89ow" ||
     pins.endpointId==="ep-long-fog-bdc5rxjn" || pins.setupRole!=="quizotab_pilot_setup" ||
     pins.runtimeRole!=="quizotab_pilot_app") throw new Error("Invalid staging identity.");
  const digest=createHash("sha256").update(JSON.stringify([plan.purpose,pins.projectId,pins.branchId,
    pins.endpointId,pins.directHost,pins.database,pins.runtimeRole,pins.setupRole,plan.origin,plan.project,
    plan.tournament,plan.spectators])).digest("hex");
  return {...plan,pins,digest};
}

export function stagingApproval(raw:unknown, trusted=approvedStagingFixtures) {
  const plan=describeStagingFixture(raw);
  if(!trusted.includes(plan.digest)) throw new Error("Staging fixture requires independent approval.");
  return plan;
}
