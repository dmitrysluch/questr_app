export function googleMapsSearch(query: string, placeId?: string): string {
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', query);
  if (placeId) url.searchParams.set('query_place_id', placeId);
  return url.toString();
}

export function callPlatform(link: string): string {
  if (!link) return '';
  let host: string;
  try {
    const url = new URL(link);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    host = url.hostname.toLowerCase();
  } catch { return ''; }
  if (host === 'zoom.us' || host.endsWith('.zoom.us')) return 'Zoom';
  if (host === 'meet.google.com') return 'Google Meet';
  if (host === 'teams.microsoft.com' || host === 'teams.live.com') return 'Microsoft Teams';
  if (host === 'meet.jit.si') return 'Jitsi Meet';
  if (host === 'whereby.com' || host.endsWith('.whereby.com')) return 'Whereby';
  if (host === 'discord.gg' || host === 'discord.com') return 'Discord';
  return '';
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
