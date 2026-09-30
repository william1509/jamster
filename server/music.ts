export type Song = {
  id: string;
  provider: "mock" | "jellyfin" | "spotify";
  providerTrackId?: string;
  spotifyUrl?: string;
  title: string;
  artist: string;
  album: string;
  releaseYear: number;
  artworkUrl?: string;
  duration?: number;
};

export interface MusicProvider {
  searchSongs(query: string): Promise<Song[]>;
  getSong(id: string): Promise<Song>;
  getStreamUrl(song: Song): string | undefined;
  dispose?(): void;
}

export class MockMusicProvider implements MusicProvider {
  async searchSongs(query: string) {
    const q = query.toLocaleLowerCase();
    return SONGS.filter((s) => `${s.title} ${s.artist}`.toLocaleLowerCase().includes(q)).slice(0, 20);
  }
  async getSong(id: string) {
    const song = SONGS.find((s) => s.id === id);
    if (!song) throw new Error("Unknown song");
    return song;
  }
  getStreamUrl(_song: Song) { return undefined; }
}

type JellyfinItem = {
  Id: string; Name: string; Album?: string; AlbumArtist?: string; Artists?: string[];
  ProductionYear?: number; DateCreated?: string; RunTimeTicks?: number; Type?: string; MediaType?: string;
};
type JellyfinAuth = { AccessToken: string; User: { Id: string } };
type JellyfinPlaylistItem = { Id: string; Name: string; ChildCount?: number };

/** Looks up Jellyfin metadata; the host browser streams the selected item directly from Jellyfin. */
export class JellyfinMusicProvider implements MusicProvider {
  private token = "";
  private userId = "";
  private baseUrl: string;
  private catalog = new Map<string, Song>();
  private username: string;
  private password: string;
  constructor(serverUrl: string, username: string, password: string) {
    const parsed = new URL(serverUrl);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password)
      throw new Error("Use an http(s) Jellyfin server URL without embedded credentials.");
    this.baseUrl = parsed.toString().replace(/\/$/, "");
    this.username = username;
    this.password = password;
  }
  private headers(authenticated = true) {
    const identity = 'MediaBrowser Client="Side A", Device="Side A Server", DeviceId="sidea-server", Version="1.0.0"';
    return {
      "Content-Type": "application/json",
      Authorization: authenticated && this.token ? `${identity}, Token="${this.token}"` : identity,
    };
  }
  async connect() {
    const credentials = { Username: this.username, Pw: this.password };
    this.username = "";
    this.password = "";
    const response = await fetch(`${this.baseUrl}/Users/AuthenticateByName`, {
      method: "POST", headers: this.headers(false), body: JSON.stringify(credentials),
    });
    if (!response.ok) {
      const contentType = response.headers.get("content-type") || "";
      const body = await response.text();
      let detail = "";
      try {
        const parsed = JSON.parse(body) as { Message?: string; Error?: string };
        detail = parsed.Message || parsed.Error || "";
      } catch { /* Proxy HTML is diagnosed by its content type below. */ }
      if (response.status === 401) throw new Error("Jellyfin rejected the login (401). Check the configured username and password.");
      if (response.status === 403 && contentType.includes("text/html"))
        throw new Error("The reverse proxy returned an HTML 403 page before Jellyfin could authenticate. Check proxy access rules, authentication middleware, and the Jellyfin URL path.");
      if (response.status === 403)
        throw new Error(`Jellyfin refused the backend login (403). Check the user's remote access permission and Jellyfin server logs.${detail ? ` Jellyfin says: ${detail.slice(0, 200)}` : ""}`);
      throw new Error(`Jellyfin returned ${response.status}. Check the server address and account.${detail ? ` ${detail.slice(0, 200)}` : ""}`);
    }
    const result = await response.json() as JellyfinAuth;
    this.token = result.AccessToken;
    this.userId = result.User.Id;
  }
  async searchSongs(query: string) {
    if (!this.token) throw new Error("Connect Jellyfin first.");
    const params = new URLSearchParams({
      SearchTerm: query, IncludeItemTypes: "Audio", Recursive: "true",
      Fields: "ProductionYear,DateCreated,Album,Artists,RunTimeTicks", Limit: "30", UserId: this.userId,
    });
    const response = await fetch(`${this.baseUrl}/Items?${params}`, { headers: this.headers() });
    if (!response.ok) throw new Error(`Jellyfin search failed (${response.status}).`);
    const data = await response.json() as { Items?: JellyfinItem[] };
    return (data.Items || []).map((item) => this.toSong(item));
  }
  async listPlaylists() {
    if (!this.token) throw new Error("Connect Jellyfin first.");
    const params = new URLSearchParams({ IncludeItemTypes: "Playlist", Recursive: "true", Fields: "ChildCount", Limit: "200", UserId: this.userId });
    const response = await fetch(`${this.baseUrl}/Users/${encodeURIComponent(this.userId)}/Items?${params}`, { headers: this.headers() });
    if (!response.ok) throw new Error(`Jellyfin playlist list failed (${response.status}).`);
    const data = await response.json() as { Items?: JellyfinPlaylistItem[] };
    return (data.Items || []).map(({ Id, Name, ChildCount }) => ({ id: Id, name: Name, trackCount: ChildCount || 0 }));
  }
  async getPlaylistSongs(playlistId: string) {
    if (!this.token) throw new Error("Connect Jellyfin first.");
    const songs: Song[] = [];
    for (let startIndex = 0; startIndex < 5000; startIndex += 200) {
      const params = new URLSearchParams({
        UserId: this.userId, Fields: "ProductionYear,DateCreated,Album,Artists,RunTimeTicks", StartIndex: String(startIndex), Limit: "200",
      });
      const response = await fetch(`${this.baseUrl}/Playlists/${encodeURIComponent(playlistId)}/Items?${params}`, { headers: this.headers() });
      if (!response.ok) throw new Error(`Jellyfin playlist tracks failed (${response.status}).`);
      const data = await response.json() as { Items?: JellyfinItem[]; TotalRecordCount?: number };
      const items = data.Items || [];
      songs.push(...items.filter((item) => item.Type === "Audio" || item.MediaType === "Audio").map((item) => this.toSong(item)));
      if (items.length < 200 || (data.TotalRecordCount !== undefined && startIndex + items.length >= data.TotalRecordCount)) return songs;
    }
    throw new Error("Jellyfin playlist imports are limited to 5,000 tracks.");
  }
  private toSong(item: JellyfinItem) {
    const song: Song = {
      id: `jellyfin:${item.Id}`, provider: "jellyfin", providerTrackId: item.Id,
      title: item.Name, artist: item.Artists?.join(", ") || item.AlbumArtist || "Unknown artist",
      album: item.Album || "",
      releaseYear: item.ProductionYear || (item.DateCreated ? new Date(item.DateCreated).getFullYear() : 0),
      duration: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10_000_000) : undefined,
    };
    this.catalog.set(song.id, song);
    return song;
  }
  async getSong(id: string) {
    const song = this.catalog.get(id);
    if (!song) throw new Error("Jellyfin track not found in the connected library.");
    return song;
  }
  getStreamUrl(song: Song) {
    if (song.provider !== "jellyfin" || !song.providerTrackId) return undefined;
    const url = new URL(`${this.baseUrl}/Audio/${encodeURIComponent(song.providerTrackId)}/stream`);
    // HTML media elements cannot set auth headers; Jellyfin accepts its API token as api_key.
    url.searchParams.set("api_key", this.token);
    return url.toString();
  }
  dispose() { this.token = ""; this.userId = ""; this.catalog.clear(); }
}

export const SONGS: Song[] = [
  { id: "s1", provider: "mock", title: "Dreams", artist: "Fleetwood Mac", album: "Rumours", releaseYear: 1977 },
  { id: "s2", provider: "mock", title: "September", artist: "Earth, Wind & Fire", album: "The Best of Earth, Wind & Fire, Vol. 1", releaseYear: 1978 },
  { id: "s3", provider: "mock", title: "Billie Jean", artist: "Michael Jackson", album: "Thriller", releaseYear: 1982 },
  { id: "s4", provider: "mock", title: "Take On Me", artist: "a-ha", album: "Hunting High and Low", releaseYear: 1985 },
  { id: "s5", provider: "mock", title: "...Baby One More Time", artist: "Britney Spears", album: "...Baby One More Time", releaseYear: 1998 },
  { id: "s6", provider: "mock", title: "Crazy in Love", artist: "BeyoncÃ© feat. Jay-Z", album: "Dangerously in Love", releaseYear: 2003 },
  { id: "s7", provider: "mock", title: "Get Lucky", artist: "Daft Punk feat. Pharrell Williams", album: "Random Access Memories", releaseYear: 2013 },
  { id: "s8", provider: "mock", title: "Blinding Lights", artist: "The Weeknd", album: "After Hours", releaseYear: 2019 },
  { id: "s9", provider: "mock", title: "Dancing Queen", artist: "ABBA", album: "Arrival", releaseYear: 1976 },
  { id: "s10", provider: "mock", title: "Mr. Brightside", artist: "The Killers", album: "Hot Fuss", releaseYear: 2003 },
  { id: "s11", provider: "mock", title: "Respect", artist: "Aretha Franklin", album: "I Never Loved a Man the Way I Love You", releaseYear: 1967 },
  { id: "s12", provider: "mock", title: "Levitating", artist: "Dua Lipa", album: "Future Nostalgia", releaseYear: 2020 },
];
