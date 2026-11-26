import { fetch as undiciFetch, ProxyAgent } from "undici";
import type { FetchLike } from "./http.js";

/**
 * fetch() that routes each request through `nextProxyUrl()`. Agents are
 * cached per proxy URL so connections are reused.
 */
export function proxiedFetch(
  nextProxyUrl: () => Promise<string | undefined>,
): FetchLike {
  const agents = new Map<string, ProxyAgent>();
  return async (url, init) => {
    const proxyUrl = await nextProxyUrl();
    if (!proxyUrl) return globalThis.fetch(url, init);
    let agent = agents.get(proxyUrl);
    if (!agent) {
      agent = new ProxyAgent(proxyUrl);
      agents.set(proxyUrl, agent);
    }
    return undiciFetch(url, { ...init, dispatcher: agent });
  };
}
