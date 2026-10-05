import { ImageResponse } from "next/og";

/**
 * Apple touch icon (S5-001) — next/og ImageResponse, 180×180 PNG.
 *
 * DEVIATION NOTE (honest evidence class): the work order asked for
 * `app/apple-icon.svg`, but Next 16.3.8's file convention recognizes
 * apple-icon only as jpg/jpeg/png or a code file (.tsx) that renders a
 * PNG — an apple-icon.svg would be silently ignored (no
 * <link rel="apple-touch-icon"> emitted). So the icon ships as a
 * build-generated PNG via this file convention instead. The vector brand
 * mark itself ships as app/icon.svg (icon.svg IS supported).
 *
 * Design: the site's near-black ground with the brand-accent decision
 * node and its routed signal dots — the LogoMark's grammar at favicon
 * scale, drawn with plain shapes (satori-safe).
 */

export const size = { width: 180, height: 180 };

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#050607",
          backgroundImage:
            "radial-gradient(circle at 72% 26%, rgba(16, 207, 143, 0.22), rgba(16, 207, 143, 0) 52%)",
        }}
      >
        {/* The decision node (the LogoMark's input circle), accent-filled. */}
        <div
          style={{
            width: 76,
            height: 76,
            borderRadius: 9999,
            backgroundColor: "#10cf8f",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* The routed signal — a dark channel through the node. */}
          <div
            style={{
              width: 34,
              height: 12,
              borderRadius: 6,
              backgroundColor: "#050607",
            }}
          />
        </div>
        {/* The chosen outputs — two signal dots, fading like the LogoMark. */}
        <div
          style={{
            position: "absolute",
            right: 22,
            top: 40,
            width: 18,
            height: 18,
            borderRadius: 9999,
            backgroundColor: "#10cf8f",
            opacity: 0.9,
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 30,
            bottom: 34,
            width: 14,
            height: 14,
            borderRadius: 9999,
            backgroundColor: "#10cf8f",
            opacity: 0.5,
          }}
        />
      </div>
    ),
    { ...size },
  );
}
