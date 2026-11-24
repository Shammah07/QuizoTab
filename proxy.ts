import { NextResponse, type NextRequest } from "next/server";
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE, LANG_HEADER, isLang } from "@/lib/i18n/config";
import { stagingEnabled } from "@/lib/staging";

// ?lang=sw or ?lang=en switches the language and remembers it for a year.
// The choice is also passed to the page being rendered, so it shows in the new language straight away.
export function proxy(request: NextRequest) {
  if (stagingEnabled()) {
    const canonical = new URL(process.env.APP_URL!);
    const forwarded = request.headers.get("x-forwarded-host");
    const write = !["GET","HEAD","OPTIONS"].includes(request.method);
    if (canonical.protocol !== "https:" || request.nextUrl.protocol!=="https:" ||
      request.headers.get("host")!==canonical.host || (forwarded!==null && forwarded!==canonical.host) ||
      (write && (request.headers.get("origin")!==canonical.origin || request.headers.get("sec-fetch-site")==="cross-site"))) {
      return new NextResponse(null,{status:403,headers:{"Cache-Control":"no-store"}});
    }
  }
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();
  const asked = request.nextUrl.searchParams.get("lang");
  if (!isLang(asked)) return NextResponse.next();

  const headers = new Headers(request.headers);
  headers.set(LANG_HEADER, asked);

  const response = NextResponse.next({ request: { headers } });
  response.cookies.set(LANG_COOKIE, asked, { path: "/", maxAge: LANG_COOKIE_MAX_AGE, sameSite: "lax" });
  return response;
}

export const config = {
  // Include pages, Server Actions and APIs in the staging ingress check.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
