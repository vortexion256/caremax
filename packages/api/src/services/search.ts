/**
 * Web search context for agents.
 * Supports SerpAPI (serpapi.com) via SERPAPI_API_KEY, or Serper (serper.dev) via SERPER_API_KEY.
 * SerpAPI: GET https://serpapi.com/search?engine=google&q=...&api_key=... (like your docs example).
 * Serper: POST google.serper.dev with X-API-KEY or Bearer.
 */

const SERPAPI_URL = 'https://serpapi.com/search';
const SERPER_URL = 'https://google.serper.dev/search';

function formatOrganicLines(
  items: Array<{ title?: string; snippet?: string; link?: string }>,
  limit: number
): string {
  const lines = items.slice(0, limit).map((o) => {
    const title = o.title ?? '';
    const snippet = o.snippet ?? '';
    return snippet ? `${title}: ${snippet}` : title;
  });
  return lines.filter(Boolean).join('\n\n');
}

export async function getSearchContext(query: string, limit = 5): Promise<string> {
  if (process.env.NODE_ENV !== 'test') {
    console.log('Search: query=', query.slice(0, 80) + (query.length > 80 ? '...' : ''));
  }

  const serpApiKey = process.env.SERPAPI_API_KEY?.trim();
  if (serpApiKey) {
    try {
      const params = new URLSearchParams({
        engine: 'google',
        q: query,
        api_key: serpApiKey,
        num: String(limit),
      });
      const res = await fetch(`${SERPAPI_URL}?${params.toString()}`);
      if (!res.ok) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn('SerpAPI error:', res.status, await res.text().catch(() => ''));
        }
      } else {
        const data = (await res.json()) as {
          organic_results?: Array<{ title?: string; snippet?: string; link?: string }>;
        };
        const organic = data.organic_results ?? [];
        if (organic.length > 0) {
          return formatOrganicLines(organic, limit);
        }
      }
    } catch (e) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn('SerpAPI search error:', e);
      }
    }
  }

  const serperKey = process.env.SERPER_API_KEY?.trim();
  if (serperKey) {
    try {
      const res = await fetch(SERPER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': serperKey,
          'Authorization': `Bearer ${serperKey}`,
        },
        body: JSON.stringify({ q: query, num: limit }),
      });
      if (!res.ok) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn('Serper API error:', res.status, await res.text().catch(() => ''));
        }
      } else {
        const data = (await res.json()) as {
          organic?: Array<{ title?: string; snippet?: string; link?: string }>;
        };
        const organic = data.organic ?? [];
        if (organic.length > 0) {
          return formatOrganicLines(organic, limit);
        }
      }
    } catch (e) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn('Serper search error:', e);
      }
    }
  }

  if (!serpApiKey && !serperKey) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('Search skipped: set SERPAPI_API_KEY or SERPER_API_KEY in .env (SerpAPI key from serpapi.com).');
    }
  }
  return '';
}
