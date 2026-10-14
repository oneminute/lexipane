export interface DropboxPkceAuthorization {
  appKey: string;
  codeVerifier: string;
  codeChallenge: string;
  authorizeUrl: string;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function buildDropboxAuthorizeUrl(
  appKey: string,
  codeChallenge: string,
): string {
  const normalizedAppKey = appKey.trim();
  const normalizedChallenge = codeChallenge.trim();

  if (!normalizedAppKey) {
    throw new Error("Dropbox app key is required.");
  }
  if (!normalizedChallenge) {
    throw new Error("Dropbox PKCE code challenge is required.");
  }

  const url = new URL("https://www.dropbox.com/oauth2/authorize");
  url.searchParams.set("client_id", normalizedAppKey);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("token_access_type", "offline");
  url.searchParams.set("code_challenge", normalizedChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function createDropboxPkceAuthorization(
  appKey: string,
): Promise<DropboxPkceAuthorization> {
  const normalizedAppKey = appKey.trim();
  if (!normalizedAppKey) {
    throw new Error("Dropbox app key is required.");
  }

  if (!globalThis.crypto?.getRandomValues || !globalThis.crypto?.subtle) {
    throw new Error(
      "This runtime does not provide the Web Crypto APIs required for Dropbox PKCE.",
    );
  }

  const random = new Uint8Array(32);
  globalThis.crypto.getRandomValues(random);
  const codeVerifier = base64Url(random);

  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier),
  );
  const codeChallenge = base64Url(new Uint8Array(digest));

  return {
    appKey: normalizedAppKey,
    codeVerifier,
    codeChallenge,
    authorizeUrl: buildDropboxAuthorizeUrl(
      normalizedAppKey,
      codeChallenge,
    ),
  };
}
