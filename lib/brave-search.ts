import { logError, logInfo } from "./telemetry";

export interface BraveResult {
  title: string;
  url: string;
  snippet: string;
}

export const searchWeb = async (query: string): Promise<BraveResult[]> => {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    logInfo("brave-search", "BRAVE_SEARCH_API_KEY not set, skipping web search");
    return [];
  }

  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=4`;
    const response = await fetch(url, {
      headers: {
        "X-Subscription-Token": apiKey,
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      logError("brave-search", "Brave Search API returned non-OK status", { status: response.status, query });
      return [];
    }

    const data = (await response.json()) as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
    };

    const results = data.web?.results ?? [];
    return results.slice(0, 3).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: (r.description ?? "").slice(0, 220)
    }));
  } catch (error) {
    logError("brave-search", "Brave Search request failed", {
      query,
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
};
