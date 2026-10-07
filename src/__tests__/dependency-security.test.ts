/**
 * Installed-package security canaries for GHSA-6qxp-vccf-f47h and
 * GHSA-jqcg-44mw-7w3h. These exercise dependency boundaries with synthetic
 * fixtures; neither vulnerable feature is used by our production entrypoints.
 */
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { fetchToken, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";

const require = createRequire(import.meta.url);
const sdkRequire = createRequire(require.resolve("@modelcontextprotocol/sdk/server/streamableHttp.js"));
// Resolve the transitive copy Express will actually load, not a new direct dependency.
const expressRequire = createRequire(sdkRequire.resolve("express"));
type RequestFixture = { socket: { remoteAddress: string }; headers: { "x-forwarded-for": string } };
type Trust = (address: string, index: number) => boolean;
const proxyaddr = expressRequire("proxy-addr") as {
  (request: RequestFixture, trust: Trust): string;
  compile(subnets: string | string[]): Trust;
};

describe("proxy-addr trust boundary", () => {
  it.each(["::ffff:10.0.0.0/8", "::/1", "::ffff:0:0/95"])(
    "does not trust IPv4 peers through the short IPv6 prefix %s", (subnet) => {
      const trust = proxyaddr.compile(subnet);
      for (const peer of ["203.0.113.10", "::ffff:203.0.113.10"]) {
        const request = { socket: { remoteAddress: peer }, headers: { "x-forwarded-for": "192.0.2.123" } };
        expect(trust(peer, 0)).toBe(false);
        expect(proxyaddr(request, trust)).toBe(peer);
      }
    }
  );

  it("does not let a malformed subnet broaden a mixed trust list", () => {
    const trust = proxyaddr.compile(["10.0.0.0/8", "::ffff:10.0.0.0/8"]);
    expect(trust("203.0.113.10", 0)).toBe(false);
    expect(trust("10.1.2.3", 0)).toBe(true);
  });

  it.each(["10.0.0.0/8", "::ffff:10.0.0.0/104"])(
    "preserves correctly scoped IPv4 proxy trust for %s", (subnet) => {
      const trust = proxyaddr.compile(subnet);
      expect(trust("203.0.113.10", 0)).toBe(false);
      for (const peer of ["10.1.2.3", "::ffff:10.1.2.3"]) {
        expect(trust(peer, 0)).toBe(true);
        expect(proxyaddr({ socket: { remoteAddress: peer }, headers: { "x-forwarded-for": "192.0.2.123" } }, trust))
          .toBe("192.0.2.123");
      }
    }
  );

  it("preserves native IPv6 subnet matching", () => {
    const trust = proxyaddr.compile("2001:db8::/32");
    expect(trust("2001:db8::123", 0)).toBe(true);
    expect(trust("2001:db9::123", 0)).toBe(false);
    expect(trust("203.0.113.10", 0)).toBe(false);
  });
});

function provider(issuer: string): OAuthClientProvider {
  return {
    redirectUrl: undefined,
    clientMetadata: { redirect_uris: [], grant_types: ["client_credentials"] },
    clientInformation: () => ({ client_id: "fixture-client", client_secret: "fixture-only", issuer }),
    tokens: () => undefined,
    saveTokens: vi.fn(),
    redirectToAuthorization: vi.fn(),
    saveCodeVerifier: vi.fn(),
    codeVerifier: () => "fixture-verifier",
    prepareTokenRequest: () => new URLSearchParams({ grant_type: "client_credentials" }),
  };
}

describe("SDK OAuth issuer binding", () => {
  it.each(["https://other.example", "https://trusted.example/other-tenant"])(
    "refuses to send stamped client credentials to %s", async (destination) => {
      const fetchFn = vi.fn(async () => new Response(JSON.stringify({ access_token: "fixture-access", token_type: "Bearer" })));
      await expect(fetchToken(provider("https://trusted.example"), destination, { fetchFn }))
        .rejects.toThrow("bound to authorization server");
      expect(fetchFn).not.toHaveBeenCalled();
    }
  );

  it.each(["https://trusted.example", "https://TRUSTED.example:443/"])(
    "preserves an equivalent legitimate issuer %s", async (destination) => {
      const fetchFn = vi.fn(async () => new Response(JSON.stringify({ access_token: "fixture-access", token_type: "Bearer" })));
      const result = await fetchToken(provider("https://trusted.example"), destination, { fetchFn });
      expect(result.access_token).toBe("fixture-access");
      expect(fetchFn).toHaveBeenCalledTimes(1);
      const requestUrl = new URL(String((fetchFn.mock.calls[0] as unknown[])[0]));
      expect(requestUrl.origin).toBe("https://trusted.example");
      expect(requestUrl.pathname).toBe("/token");
    }
  );
});
