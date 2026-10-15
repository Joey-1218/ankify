/**
 * Where "Get the extension" points.
 *
 * Production sets `NEXT_PUBLIC_EXTENSION_INSTALL_URL` to the Chrome Web Store
 * listing (baked in at build time, so redeploy after changing it). Without
 * it, e.g. in a self-hosted copy, the link falls back to the README's
 * build-from-source instructions.
 */
const FALLBACK_INSTALL_URL = "https://github.com/Joey-1218/ankify#install-the-extension";

export function getExtensionInstallUrl() {
  const configured = process.env.NEXT_PUBLIC_EXTENSION_INSTALL_URL?.trim();
  return configured && /^https:\/\//.test(configured) ? configured : FALLBACK_INSTALL_URL;
}
