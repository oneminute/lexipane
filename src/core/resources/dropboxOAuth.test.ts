import { describe, expect, it } from "vitest";
import {
  buildDropboxAuthorizeUrl,
  createDropboxPkceAuthorization,
} from "./dropboxOAuth";

describe("Dropbox OAuth PKCE", () => {
  it("builds an offline authorization-code URL with PKCE", () => {
    const url = new URL(
      buildDropboxAuthorizeUrl("app-key", "challenge-value"),
    );

    expect(url.origin).toBe("https://www.dropbox.com");
    expect(url.pathname).toBe("/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("app-key");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("token_access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge")).toBe(
      "challenge-value",
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.has("redirect_uri")).toBe(false);
  });

  it("creates a URL-safe PKCE verifier and challenge", async () => {
    const authorization =
      await createDropboxPkceAuthorization(" app-key ");

    expect(authorization.appKey).toBe("app-key");
    expect(authorization.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorization.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorization.authorizeUrl).toContain(
      "token_access_type=offline",
    );
  });

  it("rejects a missing Dropbox app key", async () => {
    await expect(
      createDropboxPkceAuthorization("   "),
    ).rejects.toThrow("Dropbox app key is required");
  });
});
