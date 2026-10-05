import { ImageResponse } from "next/og";

import { resolveSiteUrl } from "@/lib/site-routes.js";

/**
 * Open Graph social card (S5-002) — next/og ImageResponse, 1200×630.
 *
 * On-brand by construction with the docs portal design system
 * (src/app/globals.css): the warm-white background (#fbfbfa), the ink
 * foreground (#17171a), the single brand accent (#009768 Reckon green),
 * and the "Reckon Docs" wordmark from the site header — rendered with
 * the default font family (no font fetching, so the card stays
 * build-time static and dependency-free).
 *
 * ImageResponse under `next build --webpack` is the approach proven green
 * by the S5-001 marketing app on the same workspace-pinned Next 16.3.8 —
 * no static PNG fallback is needed (documented in the app README).
 *
 * Next's file convention: the emitted /opengraph-image route covers every
 * page in the root segment, and every route's routeMetadata() references
 * the path explicitly (see src/lib/site-routes.ts OG_IMAGE_PATH).
 */

export const alt =
  "Reckon Docs — provider-neutral recommendation infrastructure. Serve your first recommendation in about five minutes.";

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
          backgroundColor: "#fbfbfa",
          backgroundImage:
            "radial-gradient(circle at 82% 14%, rgba(0, 151, 104, 0.10), rgba(0, 151, 104, 0) 44%), radial-gradient(circle at 10% 94%, rgba(0, 151, 104, 0.06), rgba(0, 151, 104, 0) 38%)",
        }}
      >
        {/* Wordmark row — the site header mark: R tile + Reckon + Docs */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 46,
              height: 46,
              borderRadius: 12,
              backgroundColor: "#009768",
              color: "#ffffff",
              fontSize: 30,
              fontWeight: 700,
            }}
          >
            R
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span
              style={{
                color: "#17171a",
                fontSize: 44,
                fontWeight: 700,
                letterSpacing: -0.5,
              }}
            >
              Reckon
            </span>
            <span
              style={{
                color: "#009768",
                fontSize: 44,
                fontWeight: 600,
                letterSpacing: -0.5,
              }}
            >
              Docs
            </span>
          </div>
        </div>

        {/* Outcome phrase — one idea per line, hero grammar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              width: 96,
              height: 6,
              borderRadius: 3,
              backgroundColor: "#009768",
            }}
          />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              color: "#17171a",
              fontSize: 68,
              fontWeight: 650,
              lineHeight: 1.12,
              letterSpacing: -1.5,
            }}
          >
            <div>Docs for the</div>
            <div>recommendation loop.</div>
          </div>
          <div
            style={{
              color: "#565661",
              fontSize: 30,
              lineHeight: 1.4,
              maxWidth: 900,
            }}
          >
            Serve your first recommendation in about five minutes.
          </div>
        </div>

        {/* Footer row — the quickstart pointer and the canonical base */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 26,
            borderTop: "1px solid #e5e5ea",
          }}
        >
          <div
            style={{
              color: "#009768",
              fontSize: 24,
              letterSpacing: 1.5,
              textTransform: "uppercase",
            }}
          >
            Get started · Quickstart
          </div>
          <div style={{ color: "#71717b", fontSize: 24 }}>
            {resolveSiteUrl().replace(/^https?:\/\//, "")}
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
