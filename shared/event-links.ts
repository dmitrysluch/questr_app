export function googleMapsSearch(query: string, placeId?: string): string {
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', query);
  if (placeId) url.searchParams.set('query_place_id', placeId);
  return url.toString();
}

export function zoomLink(text: string): string | null {
  for (const candidate of text.match(/https:\/\/[^\s<>"\])]+/gi) ?? []) {
    try {
      const url = new URL(candidate.replace(/[.,;!]+$/, ''));
      if ((url.hostname === 'zoom.us' || url.hostname.endsWith('.zoom.us')) &&
          /^\/(?:j\/\d+|my\/[^/]+|wc\/join\/\d+)/.test(url.pathname)) return url.toString();
    } catch { /* Ignore malformed links in user-authored Markdown. */ }
  }
  return null;
}
