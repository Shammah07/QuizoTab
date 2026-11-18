import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { confirmEmail } from "@/lib/auth/accounts";
import { db } from "@/lib/db";

// Opened from the "Confirm email" button in the registration email (was verify.php)
export async function GET(request: NextRequest) {
  const confirmed = await confirmEmail(db(), request.nextUrl.searchParams.get("token"));
  redirect(confirmed ? "/login?notice=confirmed" : "/login?notice=link-expired");
}
