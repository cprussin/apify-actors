import { fetch as undiciFetch, ProxyAgent } from "undici";
import type { FetchFn } from "./youtube.js";

export interface ProxyUrlSource {
  newUrl(sessionId?: string): Promise<string | undefined>;
}

/**
 * Fetch that routes each request through `proxy` using a sticky session
 * (same exit IP per session ID). Without a proxy it uses the global fetch.
 */
export function makeFetch(proxy?: ProxyUrlSource): FetchFn {
  if (!proxy) return (url, init) => fetch(url, init);
  const agents = new Map<string, ProxyAgent>();
  return async (url, init, session) => {
    const proxyUrl = await proxy.newUrl(session);
    if (!proxyUrl) return fetch(url, init);
    let agent = agents.get(proxyUrl);
    if (!agent) {
      // Keep the pool small: sessions rotate after blocks.
      if (agents.size >= 50) {
        const [oldUrl, old] = agents.entries().next().value!;
        agents.delete(oldUrl);
        void old.close().catch(() => {});
      }
      agent = new ProxyAgent(proxyUrl);
      agents.set(proxyUrl, agent);
    }
    return undiciFetch(url, { ...init, dispatcher: agent });
  };
}
