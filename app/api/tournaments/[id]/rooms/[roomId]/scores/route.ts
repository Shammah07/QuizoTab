import { getSession } from "@/lib/auth/session";
import { transactionDb } from "@/lib/db";
import { scoreSubmissionHandler } from "@/lib/tournament/room-handlers";

export const POST = scoreSubmissionHandler(transactionDb, getSession);
