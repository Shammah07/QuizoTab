import { getSession } from "@/lib/auth/session";
import { transactionDb } from "@/lib/db";
import { roomHandlers } from "@/lib/tournament/room-handlers";

export const { GET, POST } = roomHandlers(transactionDb, getSession);
