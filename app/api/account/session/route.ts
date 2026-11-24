import {ApiError,route,requireUser} from "@/lib/api";
import {destroySession,listDevices,revokeDevice} from "@/lib/auth/session";
import {db} from "@/lib/db";
import {stagingEnabled} from "@/lib/staging";

async function deviceOwner() {
  if(!stagingEnabled()) throw new ApiError(404,"Unavailable.");
  return requireUser();
}
export const GET=route(async()=>{
  const actor=await deviceOwner();
  return {devices:await listDevices(db(),actor)};
});

export const POST = route(async(request)=>{
  const actor=await deviceOwner();
  const data=await request.json().catch(()=>null);
  if(!data || typeof data!=="object" || Array.isArray(data)) throw new ApiError(400,"Invalid session command.");
  if(Object.keys(data).length) {
    if(Object.keys(data).length!==1 || typeof data.sessionId!=="string" || !/^[0-9a-f]{64}$/.test(data.sessionId)) throw new ApiError(400,"Choose a session.");
    if(!await revokeDevice(db(),actor,data.sessionId)) throw new ApiError(404,"Session unavailable.");
    return {revoked:true};
  }
  await destroySession();
  return {revoked:true};
});
