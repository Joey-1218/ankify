/**
 * Where "Get the extension" points.
 *
 * Until the Chrome Web Store listing is published, the fallback is the
 * README's build-from-source instructions. Once it is live, set
 * `NEXT_PUBLIC_EXTENSION_INSTALL_URL` to the listing in Vercel and redeploy.
 */
const FALLBACK_INSTALL_URL = "https://github.com/Joey-1218/ankify#install-the-extension";

export function getExtensionInstallUrl() {
  const configured = process.env.NEXT_PUBLIC_EXTENSION_INSTALL_URL?.trim();
  return configured && /^https:\/\//.test(configured) ? configured : FALLBACK_INSTALL_URL;
}
