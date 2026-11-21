import { getSession } from "@/lib/auth/session";
import { transactionDb } from "@/lib/db";
import { lifecycleHandlers } from "@/lib/tournament/room-handlers";

export const { GET, POST } = lifecycleHandlers(transactionDb, getSession);
