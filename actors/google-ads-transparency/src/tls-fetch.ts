import { Agent, fetch as undiciFetch, ProxyAgent } from "undici";
import type { FetchLike } from "./http.js";

/**
 * OpenSSL's DEFAULT cipher order (what curl sends). Google answers Node's
 * default TLS cipher order with captchas on adstransparency.google.com from
 * many datacenter IPs, but not this one.
 */
export const CIPHERS = [
  "TLS_AES_256_GCM_SHA384",
  "TLS_CHACHA20_POLY1305_SHA256",
  "TLS_AES_128_GCM_SHA256",
  "ECDHE-ECDSA-AES256-GCM-SHA384",
  "ECDHE-RSA-AES256-GCM-SHA384",
  "DHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-CHACHA20-POLY1305",
  "ECDHE-RSA-CHACHA20-POLY1305",
  "DHE-RSA-CHACHA20-POLY1305",
  "ECDHE-ECDSA-AES128-GCM-SHA256",
  "ECDHE-RSA-AES128-GCM-SHA256",
  "DHE-RSA-AES128-GCM-SHA256",
  "ECDHE-ECDSA-AES256-SHA384",
  "ECDHE-RSA-AES256-SHA384",
  "DHE-RSA-AES256-SHA256",
  "ECDHE-ECDSA-AES128-SHA256",
  "ECDHE-RSA-AES128-SHA256",
  "DHE-RSA-AES128-SHA256",
  "ECDHE-ECDSA-AES256-SHA",
  "ECDHE-RSA-AES256-SHA",
  "DHE-RSA-AES256-SHA",
  "ECDHE-ECDSA-AES128-SHA",
  "ECDHE-RSA-AES128-SHA",
  "DHE-RSA-AES128-SHA",
  "AES256-GCM-SHA384",
  "AES128-GCM-SHA256",
  "AES256-SHA256",
  "AES128-SHA256",
  "AES256-SHA",
  "AES128-SHA",
].join(":");

/**
 * fetch() with curl-like TLS settings. `nextProxyUrl` (optional) is called
 * per request; undefined means a direct connection. Agents are cached per
 * proxy URL so connections are reused.
 */
export function tlsFetch(
  nextProxyUrl?: () => Promise<string | undefined>,
): FetchLike {
  const direct = new Agent({ connect: { ciphers: CIPHERS } });
  const agents = new Map<string, ProxyAgent>();
  return async (url, init) => {
    const proxyUrl = await nextProxyUrl?.();
    let dispatcher: Agent | ProxyAgent = direct;
    if (proxyUrl) {
      let agent = agents.get(proxyUrl);
      if (!agent) {
        agent = new ProxyAgent({
          uri: proxyUrl,
          requestTls: { ciphers: CIPHERS },
        });
        agents.set(proxyUrl, agent);
      }
      dispatcher = agent;
    }
    return undiciFetch(url, { ...init, dispatcher });
  };
}
