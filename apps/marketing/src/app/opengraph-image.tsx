import { ImageResponse } from "next/og";

import { resolveSiteUrl } from "@/lib/site-routes";

/**
 * Open Graph social card (S5-001) — next/og ImageResponse, 1200×630.
 *
 * On-brand by construction: the site's near-black background
 * (--rk-bg #050607), the single brand accent (--rk-accent #10cf8f), the
 * lowercase "reckon" wordmark, and the outcome phrase from the hero —
 * rendered with the default font family (no font fetching, so the card
 * stays build-time static and dependency-free).
 *
 * Next's file convention: the emitted /opengraph-image route covers every
 * page in the root segment, so each public route (/ , /pricing, the four
 * product pages, /terms, /privacy) resolves an og:image.
 */

export const alt =
  "Reckon — recommendation infrastructure for every product. One API call decides what to show, say, and send next.";

export const size = { width: 1200, height: 630 };

export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          backgroundColor: "#050607",
          backgroundImage:
            "radial-gradient(circle at 78% 18%, rgba(16, 207, 143, 0.16), rgba(16, 207, 143, 0) 46%), radial-gradient(circle at 12% 92%, rgba(16, 207, 143, 0.08), rgba(16, 207, 143, 0) 38%)",
        }}
      >
        {/* Wordmark row */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: 9999,
              backgroundColor: "#10cf8f",
            }}
          />
          <div
            style={{
              color: "#f2f5f4",
              fontSize: 44,
              fontWeight: 600,
              letterSpacing: -0.5,
            }}
          >
            reckon
          </div>
        </div>

        {/* Outcome phrase — one idea per line, hero grammar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              width: 96,
              height: 6,
              borderRadius: 3,
              backgroundColor: "#10cf8f",
            }}
          />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              color: "#f2f5f4",
              fontSize: 68,
              fontWeight: 650,
              lineHeight: 1.12,
              letterSpacing: -1.5,
            }}
          >
            <div>Recommendation infrastructure</div>
            <div>for every product.</div>
          </div>
          <div
            style={{
              color: "#a9b2ad",
              fontSize: 30,
              lineHeight: 1.4,
              maxWidth: 900,
            }}
          >
            One API call decides what to show, say, and send next.
          </div>
        </div>

        {/* Footer row — the route tag and the canonical base */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 26,
            borderTop: "1px solid rgba(255, 255, 255, 0.08)",
          }}
        >
          <div
            style={{
              color: "#10cf8f",
              fontSize: 24,
              letterSpacing: 1.5,
              textTransform: "uppercase",
            }}
          >
            POST /v1/decisions
          </div>
          <div style={{ color: "#6d7671", fontSize: 24 }}>
            {resolveSiteUrl().replace(/^https?:\/\//, "")}
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
