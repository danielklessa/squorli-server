/** Shape of the generated list of third-party packages (`thirdParty.ts`, written by tools/licenses.mjs). */
export type ThirdPartyPackage = {
  name: string;
  version: string;
  /** SPDX identifier as stated by the package. */
  license: string;
  url: string;
  author: string | null;
  /** What we ship of it, when it is not simply code (font, data). */
  note: string | null;
  /** Index into TEXTS, -1 = the package ships no license file. */
  text: number;
};
