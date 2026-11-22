import { getSession } from "@/lib/auth/session";
import { transactionDb } from "@/lib/db";
import { adjudicationHandlers } from "@/lib/tournament/room-handlers";

export const {GET,POST} = adjudicationHandlers(transactionDb,getSession);
