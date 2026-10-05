import type { NextConfig } from "next";

/**
 * Headers sent with every response. The Content Security Policy is not here:
 * it needs a fresh nonce per request, so proxy.ts sets it.
 */
const SECURITY_HEADERS = [
  // Browsers must not guess a content type other than the one declared.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Belt and braces with the policy's frame-ancestors, for older browsers.
  { key: "X-Frame-Options", value: "DENY" },
  // Other sites learn which site a visitor came from, never which page.
  // Pages whose URL holds a secret (reset, invite) send nothing at all.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // This application uses none of these device features.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  // Keeps this window isolated from any window that opened it or it opens.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // No need to advertise the framework and version.
  poweredByHeader: false,

  async headers() {
    const headers = [...SECURITY_HEADERS];
    if (process.env.NODE_ENV === "production") {
      // Two years, as browsers recommend. Only in production: it would make a
      // browser refuse plain-http localhost for the same length of time.
      headers.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains",
      });
    }
    return [{ source: "/(.*)", headers }];
  },
};

export default nextConfig;
