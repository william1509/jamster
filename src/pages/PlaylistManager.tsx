import React from "react";
import type { SavedPlaylist } from "../types";

export type PlaylistImportStep = "choose" | "spotify" | "jellyfin" | "";

export type PlaylistManagerProps = {
  error: string;
  playlists: SavedPlaylist[];
  playlistName: string;
  setPlaylistName: (value: string) => void;
  onCreatePlaylist: (event: React.FormEvent) => void;
  managedPlaylistId: string;
  onSelectPlaylist: (playlist: SavedPlaylist) => void;
  playlistEditName: string;
  setPlaylistEditName: (value: string) => void;
  onManagePlaylist: (event: string, payload: any, selectId?: string) => void;
  jfBusy: boolean;
  autoMatchNotice: string;
  onAutoMatch: (playlistId: string) => void;
  onResyncTracks: (playlistId: string) => void;
  matchingSong: SavedPlaylist["songs"][number] | null;
  onFindJellyfinMatch: (song: SavedPlaylist["songs"][number]) => void;
  onCloseMatch: () => void;
  jfQuery: string;
  setJfQuery: (value: string) => void;
  onSearchJellyfin: (event: React.FormEvent) => void;
  jfResults: { id: string; title: string; artist: string; album: string }[];
  onSaveJellyfinMatch: (id?: string) => void;
  importStep: PlaylistImportStep;
  setImportStep: (step: PlaylistImportStep) => void;
  importTargetId: string;
  spotifyConnected: boolean;
  spotifyBusy: boolean;
  onConnectSpotify: () => void;
  onLoadSpotifyPlaylists: () => void;
  spotifyPlaylists: { id: string; name: string; trackCount: number; url: string }[];
  spotifyPlaylistId: string;
  setSpotifyPlaylistId: (id: string) => void;
  onImportSpotify: (event: React.FormEvent) => void;
  jfConnected: boolean;
  onConnectJellyfin: () => void;
  onLoadJellyfinPlaylists: () => void;
  jfPlaylists: { id: string; name: string; trackCount: number }[];
  jfPlaylistId: string;
  setJfPlaylistId: (id: string) => void;
  onImportJellyfin: (event: React.FormEvent) => void;
};

export function PlaylistManager(props: PlaylistManagerProps) {
  const selected = props.playlists.find((playlist) => playlist.id === props.managedPlaylistId);
  const unmatchedSpotifyCount = selected?.songs.filter((song) => song.provider === "spotify" && !song.jellyfinTrackId).length || 0;
  const resyncableTrackCount = selected?.songs.filter((song) => song.provider === "spotify" || song.provider === "jellyfin").length || 0;
  const [trackSearch, setTrackSearch] = React.useState("");
  const [trackPage, setTrackPage] = React.useState(1);
  const tracksPerPage = 10;

  React.useEffect(() => {
    setTrackSearch("");
    setTrackPage(1);
  }, [props.managedPlaylistId]);

  const normalizedTrackSearch = trackSearch.trim().toLowerCase();
  const filteredTracks = selected?.songs.filter((song) => {
    const matchDescription = song.provider === "spotify"
      ? song.jellyfinTrackId ? "jellyfin matched audio" : "spotify metadata unmatched"
      : "jellyfin";
    const searchableText = [song.title, song.artist, song.album, String(song.releaseYear), song.provider || "", matchDescription].join(" ").toLowerCase();
    return searchableText.includes(normalizedTrackSearch);
  }) || [];
  const pageCount = Math.max(1, Math.ceil(filteredTracks.length / tracksPerPage));
  const currentTrackPage = Math.min(trackPage, pageCount);
  const visibleTracks = filteredTracks.slice((currentTrackPage - 1) * tracksPerPage, currentTrackPage * tracksPerPage);

  return <section className="playlist-manager">
    <div className="eyebrow">YOUR MUSIC LIBRARY</div><h2>Manage playlists</h2>
    <form className="playlist-create" onSubmit={props.onCreatePlaylist}>
      <input required maxLength={32} value={props.playlistName} onChange={(event) => props.setPlaylistName(event.target.value)} placeholder="New playlist name" />
      <button className="secondary">CREATE</button>
    </form>
    <div className="playlist-manager-grid">
      <div className="playlist-manager-list">{props.playlists.length ? props.playlists.map((playlist) => <button className={props.managedPlaylistId === playlist.id ? "playlist-manager-item selected" : "playlist-manager-item"} key={playlist.id} type="button" onClick={() => props.onSelectPlaylist(playlist)}><span>{playlist.name}</span><small>{playlist.songs.length} TRACKS</small></button>) : <p>No playlists yet. Create one to get started.</p>}</div>
      {selected && <div className="playlist-manager-detail">
        <form className="playlist-rename" onSubmit={(event) => { event.preventDefault(); props.onManagePlaylist("rename-playlist", { id: selected.id, name: props.playlistEditName }, selected.id); }}>
          <input required maxLength={32} value={props.playlistEditName} onChange={(event) => props.setPlaylistEditName(event.target.value)} aria-label="Playlist name" />
          <button className="secondary">SAVE NAME</button>
          <button className="stop-game" type="button" onClick={() => { if (window.confirm(`Delete ${selected.name} and its items?`)) props.onManagePlaylist("delete-playlist", { id: selected.id }); }}>DELETE</button>
        </form>
        {resyncableTrackCount > 0 && <button className="secondary jf-auto-match" type="button" disabled={props.jfBusy} onClick={() => props.onResyncTracks(selected.id)}>{props.jfBusy ? "SCANNING JELLYFIN..." : "RESYNC JELLYFIN TRACKS"}</button>}
        {unmatchedSpotifyCount > 0 && <button className="secondary jf-auto-match" type="button" disabled={props.jfBusy} onClick={() => props.onAutoMatch(selected.id)}>{props.jfBusy ? "SCANNING JELLYFIN..." : `AUTO-MATCH ${unmatchedSpotifyCount} TRACKS`}</button>}
        {props.autoMatchNotice && <div className="jf-count">{props.autoMatchNotice}</div>}
        <div className="playlist-manager-tracks">
          <div className="playlist-track-heading">
            <span className="eyebrow">TRACKS &middot; {selected.songs.length}</span>
            {selected.songs.length > 0 && <input className="playlist-track-search" type="search" value={trackSearch} placeholder="Search tracks" aria-label="Search tracks by title, artist, album, or year" onChange={(event) => { setTrackSearch(event.target.value); setTrackPage(1); }} />}
          </div>
          {selected.songs.length > 0 && <small className="playlist-track-count">{filteredTracks.length} OF {selected.songs.length} TRACKS</small>}
          {visibleTracks.length ? visibleTracks.map((song) => <div className="playlist-manager-track" key={song.id}>
            <span><b>{song.title}</b><small>{song.artist} &middot; {song.releaseYear}{song.album ? <> &middot; {song.album}</> : null}</small>{song.provider === "spotify" && <span className={song.jellyfinTrackId ? "jf-match-status matched" : "jf-match-status unmatched"} role="img" aria-label={song.jellyfinTrackId ? "Jellyfin audio matched" : "Spotify metadata only"} title={song.jellyfinTrackId ? "Jellyfin audio matched" : "Spotify metadata only"} />}</span>
            <div className="playlist-track-actions">{song.provider === "spotify" && <button className="secondary" type="button" onClick={() => props.onFindJellyfinMatch(song)}>{song.jellyfinTrackId ? "CHANGE AUDIO MATCH" : "FIND IN JELLYFIN"}</button>}<button className="stop-game" type="button" onClick={() => props.onManagePlaylist("remove-playlist-song", { playlistId: selected.id, songId: song.id }, selected.id)}>REMOVE</button></div>
          </div>) : <p>{selected.songs.length ? "No tracks match your search." : "This playlist has no tracks yet."}</p>}
          {pageCount > 1 && <nav className="playlist-track-pagination" aria-label="Track list pages">
            <button className="secondary" type="button" disabled={currentTrackPage === 1} onClick={() => setTrackPage(currentTrackPage - 1)}>PREVIOUS</button>
            <span>PAGE {currentTrackPage} OF {pageCount}</span>
            <button className="secondary" type="button" disabled={currentTrackPage === pageCount} onClick={() => setTrackPage(currentTrackPage + 1)}>NEXT</button>
          </nav>}
        </div>
      </div>}
    </div>

    {props.matchingSong && <div className="playlist-import-backdrop" role="presentation"><section className="playlist-import-dialog jellyfin-match-dialog" role="dialog" aria-modal="true" aria-labelledby="jellyfin-match-title">
      <button className="playlist-import-close" type="button" aria-label="Close" onClick={props.onCloseMatch}>×</button>
      <div className="eyebrow">FIND THE PLAYABLE FILE</div><h2 id="jellyfin-match-title">Match in Jellyfin</h2><p>Spotify track: <strong>{props.matchingSong.title}</strong> by {props.matchingSong.artist}</p>
      <form className="jf-search" onSubmit={props.onSearchJellyfin}><input required value={props.jfQuery} onChange={(event) => props.setJfQuery(event.target.value)} aria-label="Jellyfin search" /><button className="secondary" disabled={props.jfBusy}>{props.jfBusy ? "SEARCHING..." : "SEARCH"}</button></form>
      {props.jfBusy && <div className="jf-count">SEARCHING JELLYFIN...</div>}
      {!props.jfBusy && props.jfResults.length === 0 && <p>No results yet. Try a shorter title or artist name.</p>}
      <div className="playlist-import-list">{props.jfResults.map((candidate) => <div className="jf-match-result" key={candidate.id}><span><strong>{candidate.title}</strong><small>{candidate.artist}{candidate.album ? ` · ${candidate.album}` : ""}</small></span><button className="secondary" type="button" disabled={props.jfBusy} onClick={() => props.onSaveJellyfinMatch(candidate.id)}>USE THIS FILE</button></div>)}</div>
      {props.matchingSong.jellyfinTrackId && <button className="stop-game" type="button" disabled={props.jfBusy} onClick={() => props.onSaveJellyfinMatch()}>REMOVE AUDIO MATCH</button>}
      {props.error && <div className="error">{props.error}</div>}
    </section></div>}
    {props.importStep && <PlaylistImportDialog {...props} />}
    {props.error && <div className="error">{props.error}</div>}
  </section>;
}

function PlaylistImportDialog(props: PlaylistManagerProps) {
  return <div className="playlist-import-backdrop" role="presentation"><section className="playlist-import-dialog" role="dialog" aria-modal="true" aria-labelledby="playlist-import-title">
    <button className="playlist-import-close" type="button" aria-label="Close" onClick={() => props.setImportStep("")}>×</button>
    <div className="eyebrow">NEW PLAYLIST · {props.playlists.find((item) => item.id === props.importTargetId)?.name}</div>
    {props.importStep === "choose" ? <>
      <h2 id="playlist-import-title">How would you like to fill it?</h2><p>Choose a music source to import into your new playlist.</p>
      <div className="playlist-import-options">
        <button type="button" className="playlist-import-option" onClick={() => { props.setImportStep("spotify"); if (props.spotifyConnected) props.onLoadSpotifyPlaylists(); }}><strong>Spotify</strong><small>Choose one of your Spotify playlists</small></button>
        <button type="button" className="playlist-import-option" onClick={() => { props.setImportStep("jellyfin"); if (props.jfConnected) props.onLoadJellyfinPlaylists(); else props.onConnectJellyfin(); }}><strong>Jellyfin</strong><small>Choose one of your Jellyfin playlists</small></button>
      </div>
      <button type="button" className="secondary" onClick={() => props.setImportStep("")}>START WITH AN EMPTY PLAYLIST</button>
    </> : props.importStep === "spotify" ? <>
      <button type="button" className="playlist-import-back" onClick={() => props.setImportStep("choose")}>← BACK</button><h2 id="playlist-import-title">Choose a Spotify playlist</h2>
      {!props.spotifyConnected ? <><p>Connect your Spotify account to view its playlists.</p><button type="button" className="secondary" disabled={props.spotifyBusy} onClick={props.onConnectSpotify}>{props.spotifyBusy ? "CONNECTING..." : "CONNECT SPOTIFY"}</button></> : <>
        {props.spotifyBusy && <p>Connected to Spotify. Loading your playlists...</p>}<button type="button" className="secondary" disabled={props.spotifyBusy} onClick={props.onLoadSpotifyPlaylists}>{props.spotifyBusy ? "LOADING..." : "LOAD SPOTIFY PLAYLISTS"}</button>
        <div className="playlist-import-list">{props.spotifyPlaylists.map((item) => <button type="button" key={item.id} className={props.spotifyPlaylistId === item.id ? "playlist-import-option selected" : "playlist-import-option"} onClick={() => props.setSpotifyPlaylistId(item.id)}><strong>{item.name}</strong><small>{item.trackCount} tracks</small></button>)}</div>
        <form onSubmit={props.onImportSpotify}><button className="secondary" disabled={props.spotifyBusy || !props.spotifyPlaylistId}>{props.spotifyBusy ? "IMPORTING..." : "IMPORT SELECTED PLAYLIST"}</button></form>
      </>}
    </> : <>
      <button type="button" className="playlist-import-back" onClick={() => props.setImportStep("choose")}>← BACK</button><h2 id="playlist-import-title">Choose a Jellyfin playlist</h2>
      {!props.jfConnected ? <p>Connecting to Jellyfin...</p> : <>
        <button type="button" className="secondary" disabled={props.jfBusy} onClick={props.onLoadJellyfinPlaylists}>{props.jfBusy ? "LOADING..." : "REFRESH PLAYLISTS"}</button>
        <div className="playlist-import-list">{props.jfPlaylists.map((item) => <button type="button" key={item.id} className={props.jfPlaylistId === item.id ? "playlist-import-option selected" : "playlist-import-option"} onClick={() => props.setJfPlaylistId(item.id)}><strong>{item.name}</strong><small>{item.trackCount} tracks</small></button>)}</div>
        <form onSubmit={props.onImportJellyfin}><button className="secondary" disabled={props.jfBusy || !props.jfPlaylistId}>{props.jfBusy ? "IMPORTING..." : "IMPORT SELECTED PLAYLIST"}</button></form>
      </>}
    </>}
    {props.error && <div className="error">{props.error}</div>}
  </section></div>;
}
