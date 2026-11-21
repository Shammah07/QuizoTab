import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { assignmentHandler } from "@/lib/tournament/room-handlers";

export const GET = assignmentHandler(db, getSession);
