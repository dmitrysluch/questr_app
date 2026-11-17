export interface GooglePlace {
  id: string;
  displayName?: string;
  formattedAddress?: string;
  fetchFields(options: { fields: string[] }): Promise<unknown>;
}
export interface GooglePrediction {
  text: { toString(): string };
  toPlace(): GooglePlace;
}
interface PlacesLibrary {
  AutocompleteSessionToken: new () => object;
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions(request: {
      input: string; sessionToken: object; language: string; region?: string; includedRegionCodes?: string[];
    }): Promise<{ suggestions: { placePrediction?: GooglePrediction }[] }>;
  };
}
type MapsWindow = Window & { google?: { maps: { importLibrary: (name: string) => Promise<PlacesLibrary> } } };

let loader: Promise<PlacesLibrary> | null = null;
export function loadGooglePlaces(key: string): Promise<PlacesLibrary> {
  if (loader) return loader;
  loader = (async () => {
    if (!(window as MapsWindow).google?.maps?.importLibrary) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async`;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => { script.remove(); reject(new Error('MAPS_UNAVAILABLE')); };
        document.head.appendChild(script);
      });
    }
    const maps = (window as MapsWindow).google?.maps;
    if (!maps) throw new Error('MAPS_UNAVAILABLE');
    return maps.importLibrary('places');
  })().catch(error => { loader = null; throw error; });
  return loader;
}
