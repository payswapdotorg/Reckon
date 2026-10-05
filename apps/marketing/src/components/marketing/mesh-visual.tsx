/**
 * Gradient-mesh hero visual (survey §2 design system).
 *
 * Layered composition — never a flat two-stop CSS gradient:
 *  1. wash  — multi-stop radial base field (CSS);
 *  2. blobs — four blurred radial meshes drifting on slow independent
 *     cycles (CSS keyframes, transform/opacity only);
 *  3. liquid — SVG gradient ellipses pushed through feTurbulence +
 *     feDisplacementMap so the color fields read as liquid;
 *  4. graph — faint node-and-route motif (the "recommendation" signature);
 *  5. gloss + grain — glass highlight and fractal-noise film grain.
 *
 * All motion is CSS and is fully disabled under prefers-reduced-motion.
 * The entire figure is decorative: aria-hidden, no focusable content.
 */
export function MeshVisual() {
  return (
    <figure className="rk-mesh" aria-hidden="true">
      <div className="rk-mesh-wash" />
      <div className="rk-mesh-blob rk-mesh-blob-a" />
      <div className="rk-mesh-blob rk-mesh-blob-b" />
      <div className="rk-mesh-blob rk-mesh-blob-c" />
      <div className="rk-mesh-blob rk-mesh-blob-d" />

      <svg
        className="rk-mesh-liquid"
        viewBox="0 0 640 440"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="rk-grad-rose" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7c5cff" />
            <stop offset="1" stopColor="#ff5c8a" />
          </linearGradient>
          <linearGradient id="rk-grad-amber" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffb44d" />
            <stop offset="1" stopColor="#ff5c8a" />
          </linearGradient>
          <radialGradient id="rk-grad-teal">
            <stop offset="0" stopColor="#10cf8f" stopOpacity="0.9" />
            <stop offset="1" stopColor="#10cf8f" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="rk-grad-azure">
            <stop offset="0" stopColor="#3d7bff" stopOpacity="0.85" />
            <stop offset="1" stopColor="#3d7bff" stopOpacity="0" />
          </radialGradient>
          <filter id="rk-liquid" x="-30%" y="-30%" width="160%" height="160%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.011 0.017"
              numOctaves="3"
              seed="11"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="110"
              xChannelSelector="R"
              yChannelSelector="G"
            />
            <feGaussianBlur stdDeviation="3.5" />
          </filter>
        </defs>
        <g filter="url(#rk-liquid)">
          <ellipse cx="435" cy="120" rx="175" ry="95" fill="url(#rk-grad-rose)" opacity="0.8" />
          <ellipse cx="205" cy="300" rx="180" ry="118" fill="url(#rk-grad-amber)" opacity="0.55" />
          <ellipse cx="365" cy="245" rx="215" ry="132" fill="url(#rk-grad-teal)" opacity="0.4" />
          <ellipse cx="85" cy="75" rx="135" ry="92" fill="url(#rk-grad-azure)" opacity="0.5" />
        </g>
      </svg>

      <svg
        className="rk-mesh-graph"
        viewBox="0 0 640 440"
        preserveAspectRatio="xMidYMid slice"
      >
        <g stroke="#10cf8f" strokeWidth="1.2" fill="none" opacity="0.28">
          <path d="M120 320 C 220 280, 300 240, 470 130" />
          <path d="M120 320 C 240 330, 330 320, 520 300" />
          <path d="M470 130 C 500 180, 520 240, 520 300" />
        </g>
        <g fill="#10cf8f" opacity="0.5">
          <circle cx="120" cy="320" r="4" />
          <circle cx="470" cy="130" r="3" />
          <circle cx="520" cy="300" r="4.5" />
          <circle cx="318" cy="253" r="2" opacity="0.8" />
        </g>
      </svg>

      <div className="rk-mesh-gloss" />

      <svg className="rk-mesh-grain" aria-hidden="true">
        <filter id="rk-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#rk-grain)" />
      </svg>

      <span className="rk-mesh-chip">dec_8c41f2 · SUGGEST · 0.91</span>
    </figure>
  );
}
