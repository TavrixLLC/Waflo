import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const directHost = request.headers.get("host")?.split(":")[0]?.toLowerCase();
  const publicHost = (forwardedHost?.split(":")[0] ?? directHost)?.toLowerCase();
  const target = request.nextUrl.clone();
  let redirect = false;

  if (publicHost === "www.waflo.app") {
    target.protocol = "https";
    target.hostname = "waflo.app";
    target.port = "";
    redirect = true;
  }
  if (target.pathname === "/") {
    target.pathname = "/en";
    redirect = true;
  }
  if (redirect) return NextResponse.redirect(target, 308);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-waflo-locale", target.pathname.split("/")[1] === "ar" ? "ar" : "en");
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/:path*"],
};
