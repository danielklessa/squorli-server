/**
 * The app's own user agent: `… Squorli-Desktop/<version> Chrome/<v> Electron/<v> Safari/537.36`. Electron's default carries
 * a token made of the package name and version in that place; it is replaced. The Chrome token stays, because web players and
 * LiveKit's feature detection look for it. `labelFromUserAgent` (protocol package) turns it into "Squorli Desktop auf <OS>".
 */
export const UA_PRODUCT = "Squorli-Desktop";

export function desktopUserAgent(electronDefault: string, version: string): string {
  const product = `${UA_PRODUCT}/${version}`;
  // Whatever stands between "(KHTML, like Gecko)" and "Chrome/" is Electron's app token.
  const replaced = electronDefault.replace(/(\(KHTML, like Gecko\)) (?:.*? )?(Chrome\/)/, `$1 ${product} $2`);
  return replaced.includes(product) ? replaced : `${electronDefault} ${product}`;
}
