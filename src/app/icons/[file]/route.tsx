import { appIcon } from "@/lib/app-icon";

/**
 * The PNG icons the web app manifest points at, built once at build time.
 * `any` icons are rounded squares; the maskable one fills the square edge to
 * edge and keeps the card inside the safe zone, so Android can crop it.
 */
const ICONS = {
  "icon-192.png": () => appIcon(192),
  "icon-512.png": () => appIcon(512),
  "maskable-512.png": () => appIcon(512, { inset: 0.22, rounded: false }),
} as const;

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(ICONS).map((file) => ({ file }));
}

export async function GET(_request: Request, { params }: RouteContext<"/icons/[file]">) {
  const { file } = await params;
  const make = ICONS[file as keyof typeof ICONS];
  if (!make) return new Response("Not found", { status: 404 });
  return make();
}
