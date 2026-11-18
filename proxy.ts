import { NextResponse, type NextRequest } from "next/server";
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE, LANG_HEADER, isLang } from "@/lib/i18n/config";

// ?lang=sw or ?lang=en switches the language and remembers it for a year.
// The choice is also passed to the page being rendered, so it shows in the new language straight away.
export function proxy(request: NextRequest) {
  const asked = request.nextUrl.searchParams.get("lang");
  if (!isLang(asked)) return NextResponse.next();

  const headers = new Headers(request.headers);
  headers.set(LANG_HEADER, asked);

  const response = NextResponse.next({ request: { headers } });
  response.cookies.set(LANG_COOKIE, asked, { path: "/", maxAge: LANG_COOKIE_MAX_AGE, sameSite: "lax" });
  return response;
}

export const config = {
  // Pages only: skip API routes, Next.js internals and files
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"],
};
