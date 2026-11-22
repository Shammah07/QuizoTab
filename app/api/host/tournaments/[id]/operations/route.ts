import { transactionDb } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { operationsHandlers } from "@/lib/tournament/room-handlers";
export const {GET,POST} = operationsHandlers(transactionDb,getSession);
