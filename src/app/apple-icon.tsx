import { appIcon } from "@/lib/app-icon";

/** The iPhone home screen icon. iOS rounds the corners itself. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return appIcon(180, { inset: 0.16, rounded: false });
}
