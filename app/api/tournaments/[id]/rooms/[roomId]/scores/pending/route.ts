import { getSession } from "@/lib/auth/session";
import { transactionDb } from "@/lib/db";
import { scoreReviewHandlers } from "@/lib/tournament/room-handlers";

export const GET = scoreReviewHandlers(transactionDb, getSession).pending;
