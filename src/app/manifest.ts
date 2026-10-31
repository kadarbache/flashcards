import type { MetadataRoute } from "next";

/**
 * What makes the app installable: name, colours, icons, and opening full
 * screen. Served at /manifest.webmanifest, which the proxy lets through
 * without a sign-in, since browsers fetch it without cookies.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Flashcards",
    short_name: "Flashcards",
    description: "Spaced-repetition flashcards you play like a game.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0F0D1A",
    theme_color: "#0F0D1A",
    categories: ["education", "games"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [{ name: "How to play", url: "/help" }],
  };
}
