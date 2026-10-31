import { ImageResponse } from "next/og";

/**
 * The app icon: a gold card with a bolt, tilted, on the dark ground. Drawn in
 * code so every size comes from one source.
 *
 * `inset` is how much of the square the card leaves empty around it. Maskable
 * icons need about 20%, because Android crops them to a circle or squircle.
 */
export function appIcon(size: number, { inset = 0.14, rounded = true } = {}): ImageResponse {
  const card = Math.round(size * (1 - inset * 2));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0F0D1A",
          borderRadius: rounded ? size * 0.22 : 0,
        }}
      >
        <svg width={card} height={card} viewBox="0 0 32 32">
          <rect x="7" y="3.5" width="18" height="25" rx="4.5" fill="#FFD24A" transform="rotate(-8 16 16)" />
          <path d="M17.5 8.5 11 18h4.8l-1 5.8L21.3 14h-4.8l1-5.5z" fill="#16122B" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
