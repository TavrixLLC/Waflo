import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/") {
    return NextResponse.redirect(new URL("/en/login", request.url));
  }
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(
    "x-waflo-locale",
    request.nextUrl.pathname.split("/")[1] === "ar" ? "ar" : "en",
  );
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = { matcher: ["/:path*"] };
