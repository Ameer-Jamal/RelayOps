/** Only endpoints belonging to Teams may receive its session credentials. */
export function teamsApiEndpoint(raw: string): { baseUrl: string; region: string; proxy: boolean } | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.port || url.username || url.password) return undefined;
    const legacy = url.hostname.match(/^([a-z0-9-]+)\.ng\.msg\.teams\.microsoft\.com$/i);
    if (legacy && /^\/v1(?:\/|$)/.test(url.pathname)) {
      return { baseUrl: `${url.origin}/v1`, region: legacy[1]!, proxy: false };
    }
    const proxy = url.pathname.match(/^\/api\/chatsvc\/([a-z0-9-]+)\/v1(?:\/|$)/i);
    if (["teams.cloud.microsoft", "teams.microsoft.com"].includes(url.hostname) && proxy) {
      return { baseUrl: `${url.origin}/api/chatsvc/${proxy[1]}/v1`, region: proxy[1]!, proxy: true };
    }
  } catch { /* Invalid URL. */ }
    return undefined;
}

export function teamsProfileEndpoint(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    const match = url.pathname.match(/^(\/api\/mt\/part\/[a-z0-9-]+\/beta)\//i);
    if (url.protocol === "https:" && !url.port && !url.username && !url.password &&
      ["teams.cloud.microsoft", "teams.microsoft.com"].includes(url.hostname) && match) return url.origin + match[1];
  } catch { /* Invalid URL. */ }
  return undefined;
}
