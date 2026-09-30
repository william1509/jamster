import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io, Socket } from "socket.io-client";
import { QRCodeSVG } from "qrcode.react";
import "./style.css";
import "./jellyfin.css";

type Player = { id: string; name: string; score: number; connected: boolean };
type SavedPlaylist = { id: string; name: string; songs: { id: string; title: string; artist: string; album: string; releaseYear: number }[] };
type Game = {
  code: string;
  status: string;
  round: number;
  maxRounds: number;
  players: Player[];
  answered: number;
  answeredPlayers: string[];
  playlists: { id: string; name: string; trackCount: number }[];
  selectedPlaylistId: string;
  roundEndsAt?: number;
  roundTimeRemainingMs?: number;
  musicPlaying: boolean;
  musicSource: "MOCK" | "JELLYFIN";
  jellyfinAvailable: boolean;
  song?: { title: string; artist: string; releaseYear: number; spotifyUrl?: string };
  results?: { playerId: string; title: string; artist: string; year: number | null; points: number }[];
};
const socket: Socket = io({ autoConnect: false });
function App() {
  const [libraryId] = useState(() => {
    let id = localStorage.getItem("sidea-library-id");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("sidea-library-id", id); }
    return id;
  });
  const [game, setGame] = useState<Game | null>(null),
    [me, setMe] = useState(""),
    [host, setHost] = useState(false),
    [name, setName] = useState(""),
    [code, setCode] = useState(() => location.pathname.match(/^\/join\/([A-Za-z0-9]{4})\/?$/)?.[1]?.toUpperCase() || ""),
    [err, setErr] = useState(""),
    [submitted, setSubmitted] = useState(false),
    [playing, setPlaying] = useState(false),
    [tick, setTick] = useState(60),
    [roundEndsAt, setRoundEndsAt] = useState(0),
    [streamUrl, setStreamUrl] = useState(""),
    [jfConnected, setJfConnected] = useState(false),
    [jfQuery, setJfQuery] = useState(""),
    [playlistName, setPlaylistName] = useState(""),
    [playlistManagerOpen, setPlaylistManagerOpen] = useState(false),
    [savedPlaylists, setSavedPlaylists] = useState<SavedPlaylist[]>([]),
    [managedPlaylistId, setManagedPlaylistId] = useState(""),
    [playlistEditName, setPlaylistEditName] = useState(""),
    [spotifyUrl, setSpotifyUrl] = useState(""),
    [spotifyConnected, setSpotifyConnected] = useState(false),
    [spotifyBusy, setSpotifyBusy] = useState(false),
    [spotifyNotice, setSpotifyNotice] = useState(""),
    [spotifyCallbackOrigin, setSpotifyCallbackOrigin] = useState(""),
    [spotifySource, setSpotifySource] = useState<{ name: string; url: string } | null>(null),
    [jfResults, setJfResults] = useState<{ id: string; title: string; artist: string; album: string }[]>([]),
    [jfPlaylists, setJfPlaylists] = useState<{ id: string; name: string; trackCount: number }[]>([]),
    [jfPlaylistId, setJfPlaylistId] = useState(""),
    [jfNotice, setJfNotice] = useState(""),
    [jfBusy, setJfBusy] = useState(false),
    [confirmStop, setConfirmStop] = useState(false),
    [answers, setAnswers] = useState({ title: "", artist: "", year: "" });
  const audioRef = useRef<HTMLAudioElement>(null);
  const soundContextRef = useRef<AudioContext | null>(null);
  const hostRef = useRef(false);
  const previousRoundStateRef = useRef<{ status: string; round: number } | null>(null);
  const playGameSound = (cue: "lock-in" | "round-start" | "round-end") => {
    try {
      const context = soundContextRef.current ?? new AudioContext();
      soundContextRef.current = context;
      void context.resume().then(() => {
        const notes = cue === "lock-in"
          ? [[880, 0, 0.11], [1175, 0.09, 0.16]]
          : cue === "round-start"
            ? [[523, 0, 0.16], [659, 0.13, 0.16], [784, 0.26, 0.25]]
            : [[659, 0, 0.2], [523, 0.17, 0.2], [392, 0.34, 0.32]];
        for (const [frequency, offset, duration] of notes) {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          const startsAt = context.currentTime + offset;
          oscillator.type = "sine";
          oscillator.frequency.setValueAtTime(frequency, startsAt);
          gain.gain.setValueAtTime(0.0001, startsAt);
          gain.gain.exponentialRampToValueAtTime(0.085, startsAt + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.start(startsAt);
          oscillator.stop(startsAt + duration + 0.01);
        }
      });
    } catch {
      /* Audio is optional when the browser does not support Web Audio. */
    }
  };
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!spotifyCallbackOrigin || event.origin !== spotifyCallbackOrigin || event.data?.type !== "spotify-auth-complete") return;
      setSpotifyConnected(Boolean(event.data.ok));
      if (!event.data.ok) setErr(event.data.message || "Spotify authorization failed.");
      else {
        setErr("");
        setSpotifyNotice("Spotify connected.");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [spotifyCallbackOrigin]);
  const saved = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("sidea-session") || "null");
    } catch {
      return null;
    }
  }, []);
  useEffect(() => {
    socket.connect();
    socket.on("game-state", (g: Game) => {
      const previous = previousRoundStateRef.current;
      if (hostRef.current && previous) {
        if (g.status === "PLAYING" && (previous.status !== "PLAYING" || previous.round !== g.round)) playGameSound("round-start");
        else if (previous.status === "PLAYING" && (g.status === "REVEAL" || g.status === "GAME_OVER")) playGameSound("round-end");
      }
      previousRoundStateRef.current = { status: g.status, round: g.round };
      setGame(g);
      setJfConnected(g.jellyfinAvailable);
      setPlaying(g.musicPlaying);
      setRoundEndsAt(g.roundEndsAt || 0);
      if (g.roundEndsAt) setTick(Math.max(0, Math.ceil((g.roundEndsAt - Date.now()) / 1000)));
      else if (g.status === "PLAYING" && g.roundTimeRemainingMs !== undefined)
        setTick(Math.max(0, Math.ceil(g.roundTimeRemainingMs / 1000)));
      setSubmitted(g.status === "PLAYING" && Boolean(me) && g.answeredPlayers?.includes(me));
      if (g.status === "REVEAL" || g.status === "GAME_OVER") {
        setPlaying(false);
        setStreamUrl("");
        audioRef.current?.pause();
      }
    });
    socket.on("host-track", (track: { streamUrl?: string; simulated?: boolean; roundEndsAt?: number }) => {
      setStreamUrl(track.streamUrl || "");
      setPlaying(Boolean(track.simulated));
      if (track.simulated) void emit("set-music-playing", { playing: true });
      setRoundEndsAt(track.roundEndsAt || 0);
      if (track.roundEndsAt) setTick(Math.max(0, Math.ceil((track.roundEndsAt - Date.now()) / 1000)));
    });
    socket.on("all-answered", () => {});
    socket.on("answer-locked", () => {
      if (hostRef.current) playGameSound("lock-in");
    });
    if (saved?.code && saved?.playerId) {
      socket.emit("join-game", { code: saved.code, playerId: saved.playerId, name: saved.name || "Player" }, (res: any) => {
        if (res?.game) {
          setMe(res.playerId);
          setGame(res.game);
          hostRef.current = Boolean(saved.host);
          setHost(saved.host || false);
          setName(saved.name || "");
          void emit("spotify-status", { libraryId }).then((status) => setSpotifyConnected(Boolean(status?.connected)));
        }
      });
    }
    return () => {
      socket.off("game-state");
      socket.off("host-track");
      socket.off("answer-locked");
      socket.disconnect();
    };
  }, []);
  useEffect(() => {
    if (!host || game?.status !== "PLAYING" || !streamUrl || tick <= 0) return;
    const player = audioRef.current;
    if (!player) return;
    let active = true;
    player
      .play()
      .then(() => {
        if (active) {
          setPlaying(true);
          setErr("");
        }
      })
      .catch(() => {
        if (active) {
          setPlaying(false);
          setErr("Your browser blocked automatic playback. Tap Play once to start the song.");
        }
      });
    return () => {
      active = false;
    };
  }, [host, game?.status, streamUrl, tick <= 0]);
  useEffect(() => {
    if (game?.status !== "PLAYING" || !roundEndsAt) return;
    const refresh = () => {
      const remaining = Math.max(0, Math.ceil((roundEndsAt - Date.now()) / 1000));
      setTick(remaining);
      if (remaining === 0 && host) {
        audioRef.current?.pause();
        setPlaying(false);
      }
    };
    refresh();
    const t = setInterval(refresh, 200);
    return () => clearInterval(t);
  }, [host, game?.status, roundEndsAt]);
  const remember = (g: Game, id: string, isHost: boolean, n: string) => {
    setPlaylistManagerOpen(false);
    hostRef.current = isHost;
    setGame(g);
    setMe(id);
    setHost(isHost);
    setName(n);
    localStorage.setItem("sidea-session", JSON.stringify({ code: g.code, playerId: id, host: isHost, name: n }));
    void emit("spotify-status", { libraryId }).then((status) => setSpotifyConnected(Boolean(status?.connected)));
  };
  const emit = (event: string, payload: any = {}) => new Promise<any>((resolve) => socket.emit(event, payload, resolve));
  const create = async () => {
    setErr("");
    const r = await emit("create-game", { name: name || "Host" });
    if (r.error) setErr(r.error);
    else { setPlaylistManagerOpen(false); remember(r.game, r.playerId, true, name || "Host"); }
  };
  const refreshSavedPlaylists = async (selectId?: string) => {
    const r = await emit("list-playlists");
    if (r?.error) { setErr(r.error); return; }
    const items: SavedPlaylist[] = r.playlists || [];
    setSavedPlaylists(items);
    const nextId = selectId || (items.some((item) => item.id === managedPlaylistId) ? managedPlaylistId : items[0]?.id || "");
    setManagedPlaylistId(nextId);
    setPlaylistEditName(items.find((item) => item.id === nextId)?.name || "");
  };
  const managePlaylist = async (event: string, payload: any, selectId?: string) => {
    const r = await emit(event, payload);
    if (r?.error) { setErr(r.error); return false; }
    setErr("");
    await refreshSavedPlaylists(selectId);
    return true;
  };
  const createManagedPlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await emit("create-playlist", { name: playlistName });
    if (r?.error) { setErr(r.error); return; }
    setPlaylistName("");
    await refreshSavedPlaylists(r.playlist?.id);
    setErr("");
  };
  const join = async () => {
    setErr("");
    const r = await emit("join-game", { code, name, playerId: saved?.code === code.toUpperCase() ? saved.playerId : undefined });
    if (r.error) setErr(r.error);
    else remember(r.game, r.playerId, false, name);
  };
  const act = async (event: string) => {
    const r = await emit(event);
    if (r?.error) setErr(r.error);
    else setErr("");
  };
  const setRoundCount = async (count: number) => {
    const r = await emit("set-round-count", { count });
    if (r?.error) setErr(r.error);
    else setErr("");
  };
  const connectJellyfin = async () => {
    setJfBusy(true);
    setErr("");
    const r = await emit("library-jellyfin-connect", {});
    setJfBusy(false);
    if (r?.error) setErr(r.error);
    else {
      setJfConnected(true);
      setErr("");
      void loadJellyfinPlaylists();
    }
  };
  const loadJellyfinPlaylists = async () => {
    setJfBusy(true);
    setErr("");
    const r = await emit("library-jellyfin-playlists", {});
    setJfBusy(false);
    if (r?.error) setErr(r.error);
    else {
      const items = r.playlists || [];
      setJfPlaylists(items);
      setJfPlaylistId((selected) => (items.some((item: { id: string }) => item.id === selected) ? selected : items[0]?.id || ""));
      setJfNotice(items.length ? `${items.length} Jellyfin playlists available.` : "No Jellyfin playlists found for this account.");
    }
  };
  const importJellyfinPlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    setJfBusy(true);
    setErr("");
    const r = await emit("library-jellyfin-import-playlist", { id: jfPlaylistId, playlistId: managedPlaylistId });
    setJfBusy(false);
    if (r?.error) setErr(r.error);
    else { setJfNotice(`Imported ${r.importedCount} tracks. Playlist now has ${r.totalCount} songs.`); await refreshSavedPlaylists(managedPlaylistId); }
  };
  const searchJellyfin = async (e: React.FormEvent) => {
    e.preventDefault();
    setJfBusy(true);
    setErr("");
    const r = await emit("library-jellyfin-search", { query: jfQuery });
    setJfBusy(false);
    if (r?.error) setErr(r.error);
    else setJfResults(r.songs || []);
  };
  const addJellyfinSong = async (id: string) => {
    const r = await emit("library-jellyfin-add-song", { id, playlistId: managedPlaylistId });
    if (r?.error) setErr(r.error);
    else { setErr(""); await refreshSavedPlaylists(managedPlaylistId); }
  };
  const connectSpotify = async () => {
    const popup = window.open("about:blank", "sidea-spotify-auth", "popup,width=520,height=720");
    if (!popup) {
      setErr("Allow popups to connect Spotify.");
      return;
    }
    setSpotifyBusy(true);
    setErr("");
    const result = await emit("spotify-auth-url", { libraryId });
    setSpotifyBusy(false);
    if (result?.error) {
      popup.close();
      setErr(result.error);
      return;
    }
    setSpotifyCallbackOrigin(result.callbackOrigin);
    popup.location.href = result.url;
  };
  const disconnectSpotify = async () => {
    const result = await emit("spotify-disconnect", { libraryId });
    if (result?.error) setErr(result.error);
    else setSpotifyConnected(false);
  };
  const importSpotify = async (e: React.FormEvent) => {
    e.preventDefault();
    setSpotifyBusy(true);
    setErr("");
    const result = await emit("spotify-import", { url: spotifyUrl, playlistId: managedPlaylistId, libraryId });
    setSpotifyBusy(false);
    if (result?.error) setErr(result.error);
    else {
      setSpotifySource({ name: result.playlistName, url: result.playlistUrl });
      setSpotifyUrl("");
      setSpotifyNotice(`Imported ${result.importedCount} tracks from "${result.playlistName}".`);
      await refreshSavedPlaylists(managedPlaylistId);
    }
  };
  const selectPlaylist = async (id: string) => {
    const r = await emit("select-playlist", { id });
    if (r?.error) setErr(r.error);
    else setErr("");
  };
  const toggleMusic = () => {
    if (tick <= 0) return;
    if (streamUrl) {
      const player = audioRef.current;
      if (!player) return;
      if (player.paused)
        void player
          .play()
          .then(() => emit("set-music-playing", { playing: true }))
          .catch(() => setErr("The host browser could not play this Jellyfin stream."));
      else {
        player.pause();
        void emit("set-music-playing", { playing: false });
      }
    } else {
      const next = !playing;
      setPlaying(next);
      void emit("set-music-playing", { playing: next });
    }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await emit("submit-answer", {
      title: answers.title,
      artist: answers.artist,
      year: answers.year ? Number(answers.year) : null,
    });
    if (r?.error) setErr(r.error);
    else {
      setSubmitted(true);
      setErr("");
    }
  };
  const link = `${location.origin}/join/${game?.code || ""}`,
    hasSubmitted = submitted || Boolean(game?.answeredPlayers?.includes(me));
  if (!game)
    return (
      <main className="landing">
        <header className="brand">
          <span className="brand-icon">◖</span>
          <span>SIDE A</span>
          <span className="brand-note">THE MUSIC TIMELINE GAME</span>
        </header>
        <div className="intro">
          <div className="eyebrow">A LITTLE FRIENDLY COMPETITION</div>
          <h1>
            Somewhere in
            <br />
            the <em>song</em> of time.
          </h1>
          <p>Hear a hit. Place it on the timeline. Prove your music memory.</p>
          <div className="entry-card">
            <label>Your name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="What should we call you?" maxLength={20} />
            <button className="primary" onClick={create}>
              HOST A GAME <span>↗</span>
            </button>
            <button className="secondary playlist-manager-open" type="button" onClick={() => {
              setPlaylistManagerOpen((open) => !open);
              if (!playlistManagerOpen) {
                void refreshSavedPlaylists();
                void emit("spotify-status", { libraryId }).then((status) => setSpotifyConnected(Boolean(status?.connected)));
              }
            }}>{playlistManagerOpen ? "CLOSE PLAYLIST MANAGER" : "MANAGE PLAYLISTS"}</button>
            <div className="divider">
              <span /> OR JOIN A GAME <span />
            </div>
            <div className="joinline">
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ROOM CODE" maxLength={4} />
              <button className="secondary" onClick={join}>
                JOIN ROOM
              </button>
            </div>
            {err && <div className="error">{err}</div>}
          </div>
        </div>
        {playlistManagerOpen && <section className="playlist-manager">
          <div className="eyebrow">YOUR MUSIC LIBRARY</div><h2>Manage playlists</h2>
          <form className="playlist-create" onSubmit={createManagedPlaylist}>
            <input required maxLength={32} value={playlistName} onChange={(e) => setPlaylistName(e.target.value)} placeholder="New playlist name" />
            <button className="secondary">CREATE</button>
          </form>
          <div className="playlist-manager-grid">
            <div className="playlist-manager-list">{savedPlaylists.length ? savedPlaylists.map((playlist) => <button className={managedPlaylistId === playlist.id ? "playlist-manager-item selected" : "playlist-manager-item"} key={playlist.id} type="button" onClick={() => { setManagedPlaylistId(playlist.id); setPlaylistEditName(playlist.name); }}><span>{playlist.name}</span><small>{playlist.songs.length} TRACKS</small></button>) : <p>No playlists yet. Create one to get started.</p>}</div>
            {savedPlaylists.find((playlist) => playlist.id === managedPlaylistId) && (() => {
              const selected = savedPlaylists.find((playlist) => playlist.id === managedPlaylistId)!;
              return <div className="playlist-manager-detail">
                <form className="playlist-rename" onSubmit={(e) => { e.preventDefault(); void managePlaylist("rename-playlist", { id: selected.id, name: playlistEditName }, selected.id); }}><input required maxLength={32} value={playlistEditName} onChange={(e) => setPlaylistEditName(e.target.value)} aria-label="Playlist name" /><button className="secondary">SAVE NAME</button><button className="stop-game" type="button" onClick={() => { if (window.confirm(`Delete ${selected.name} and its items?`)) void managePlaylist("delete-playlist", { id: selected.id }); }}>DELETE</button></form>
                <div className="playlist-manager-tracks"><span className="eyebrow">TRACKS · {selected.songs.length}</span>{selected.songs.length ? selected.songs.map((song) => <div className="playlist-manager-track" key={song.id}><span><b>{song.title}</b><small>{song.artist} · {song.releaseYear}{song.album ? ` · ${song.album}` : ""}</small></span><button className="stop-game" type="button" onClick={() => void managePlaylist("remove-playlist-song", { playlistId: selected.id, songId: song.id }, selected.id)}>REMOVE</button></div>) : <p>This playlist has no tracks yet.</p>}</div>
                <div className="spotify-import">
                  <div className="eyebrow">SPOTIFY PLAYLIST IMPORT</div>
                  <div className="spotify-connect-row"><button className="secondary" type="button" disabled={spotifyBusy} onClick={spotifyConnected ? disconnectSpotify : connectSpotify}>{spotifyBusy ? "PLEASE WAIT..." : spotifyConnected ? "DISCONNECT SPOTIFY" : "CONNECT SPOTIFY"}</button><span>{spotifyConnected ? "CONNECTED" : "READ ACCESS ONLY"}</span></div>
                  {spotifyConnected && <form className="spotify-import-form" onSubmit={importSpotify}><input required value={spotifyUrl} onChange={(e) => setSpotifyUrl(e.target.value)} placeholder="Spotify playlist link" aria-label="Spotify playlist link" /><button className="secondary" disabled={spotifyBusy}>{spotifyBusy ? "IMPORTING..." : "IMPORT TRACKS"}</button></form>}
                  {spotifyNotice && <div className="jf-count">{spotifyNotice}</div>}
                  {spotifySource && <p className="spotify-source">Source playlist: <a href={spotifySource.url} target="_blank" rel="noreferrer">{spotifySource.name} - Spotify</a></p>}
                </div>
                <div className="jf-panel">
                  <div className="eyebrow">JELLYFIN MUSIC LIBRARY</div>
                  <p>Search your Jellyfin library or import a Jellyfin playlist into “{selected.name}”.</p>
                  <button className="secondary" type="button" disabled={jfBusy} onClick={connectJellyfin}>{jfBusy ? "CHECKING..." : jfConnected ? "JELLYFIN CONNECTED" : "CHECK JELLYFIN CONNECTION"}</button>
                  {jfConnected && <>
                    <div className="jf-playlist-import"><button className="secondary" type="button" disabled={jfBusy} onClick={loadJellyfinPlaylists}>{jfBusy ? "LOADING..." : "LOAD JELLYFIN PLAYLISTS"}</button>{jfPlaylists.length > 0 && <form onSubmit={(e) => { e.preventDefault(); void importJellyfinPlaylist(e); }}><select aria-label="Jellyfin playlist" value={jfPlaylistId} onChange={(e) => setJfPlaylistId(e.target.value)}>{jfPlaylists.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.trackCount} tracks</option>)}</select><button className="secondary" disabled={jfBusy || !jfPlaylistId}>IMPORT PLAYLIST</button></form>}{jfNotice && <div className="jf-count">{jfNotice}</div>}</div>
                    <form className="jf-search" onSubmit={searchJellyfin}><input required value={jfQuery} onChange={(e) => setJfQuery(e.target.value)} placeholder="Search tracks or artists" /><button className="secondary" disabled={jfBusy}>{jfBusy ? "SEARCHING..." : "SEARCH"}</button></form>
                    {jfResults.map((song) => <div className="jf-result" key={song.id}><span><strong>{song.title}</strong><small>{song.artist}{song.album ? ` · ${song.album}` : ""}</small></span><button className="secondary" disabled={jfBusy} onClick={() => void addJellyfinSong(song.id)}>ADD TRACK</button></div>)}
                  </>}
                </div>
              </div>;
            })()}
          </div>
          {err && <div className="error">{err}</div>}
        </section>}
        <footer>GOOD MUSIC. QUESTIONABLE YEAR ESTIMATES.</footer>
      </main>
    );
  const sorted = [...game.players].sort((a, b) => b.score - a.score),
    answered = game.answered || 0,
    participants = game.players.filter((p) => p.connected),
    lockedPlayers = game.players.filter((p) => game.answeredPlayers?.includes(p.id)),
    myResult = game.results?.find((a) => a.playerId === me);
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">◖</span>
          <span>SIDE A</span>
        </div>
        <div className="room-pill">
          <span>ROOM</span> {game.code}
        </div>
        <div className="top-round">{game.status === "LOBBY" ? "THE LINEUP" : `ROUND ${game.round} / ${game.maxRounds}`}</div>
        {host &&
          game.status !== "GAME_OVER" &&
          (confirmStop ? (
            <div className="stop-confirm">
              <button onClick={() => setConfirmStop(false)}>CANCEL</button>
              <button
                onClick={() => {
                  setConfirmStop(false);
                  void act("stop-game");
                }}
              >
                END GAME
              </button>
            </div>
          ) : (
            <button className="stop-game" onClick={() => setConfirmStop(true)}>
              STOP GAME
            </button>
          ))}
      </header>
      {game.status === "LOBBY" && (
        <section className="lobby">
          <div className="section-title">
            <div>
              <div className="eyebrow">ROOM {game.code}</div>
              <h1>
                Bring your <em>people.</em>
              </h1>
              <p>Scan in or share the code. The more, the merrier.</p>
            </div>
            <div className="qr">
              <QRCodeSVG value={link} size={100} bgColor="transparent" fgColor="#f2eadc" />
              <small>SCAN TO JOIN</small>
            </div>
          </div>
          <div className="lobby-grid">
            <div className="player-panel">
              <div className="panel-head">
                <span>AT THE PARTY</span>
                <span>{game.players.length} PLAYERS</span>
              </div>
              {game.players.map((p, i) => (
                <div className="player-row" key={p.id}>
                  <span className="avatar" style={{ "--h": `${(i * 63 + 25) % 360}deg` } as React.CSSProperties}>
                    {p.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    {p.name} {p.id === game.players[0]?.id && <small className="host-tag">HOST</small>}
                  </span>
                  <i className={p.connected ? "online" : "offline"} />
                </div>
              ))}
            </div>
            <div className="invite-panel">
              <div className="eyebrow">SEND THE INVITE</div>
              <div className="invite-code">{game.code}</div>
              <button className="secondary" onClick={() => navigator.clipboard?.writeText(link)}>
                COPY JOIN LINK ↗
              </button>
              <p>Waiting for your crew to show up.</p>
            </div>
          </div>
          {host && <div className="jf-panel game-playlist-config">
            <div className="eyebrow">GAME CONFIGURATION</div>
            <label className="playlist-select-label">GAME PLAYLIST
              <select value={game.selectedPlaylistId} disabled={game.round > 0 || !game.playlists.length} onChange={(e) => selectPlaylist(e.target.value)}>
                {!game.playlists.length && <option value="">No playlists available</option>}
                {game.playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name} · {playlist.trackCount} tracks</option>)}
              </select>
            </label>
            <div className="jf-count">{game.playlists.find((playlist) => playlist.id === game.selectedPlaylistId)?.trackCount || 0} TRACKS IN SELECTED PLAYLIST</div>
          </div>}
          {false && host && (
            <div className="jf-panel">
              <div className="eyebrow">OPTIONAL · YOUR JELLYFIN MUSIC</div>
              <div className="playlist-controls">
                <label className="playlist-select-label">
                  GAME PLAYLIST
                  <select value={game.selectedPlaylistId} disabled={game.round > 0} onChange={(e) => selectPlaylist(e.target.value)}>
                    {!game.playlists.length && <option value="">No playlists available</option>}
                    {game.playlists.map((playlist) => (
                      <option key={playlist.id} value={playlist.id}>
                        {playlist.name} � {playlist.trackCount} songs
                      </option>
                    ))}
                  </select>
                </label>
                <div className="jf-count">{game.playlists.find((p) => p.id === game.selectedPlaylistId)?.name || "No playlist selected"}</div>
              </div>
              {game.round === 0 && (
                <div className="jf-count">
                  SELECTED PLAYLIST: {game.playlists.find((p) => p.id === game.selectedPlaylistId)?.trackCount || 0} SONGS
                </div>
              )}
              {game.round === 0 && (
                <div className="spotify-import">
                  <div className="eyebrow">SPOTIFY PLAYLIST IMPORT</div>
                  <p>
                    Import track names and release years from a playlist owned by or shared with your Spotify account. Playback stays
                    external.
                  </p>
                  <div className="spotify-connect-row">
                    <button
                      className="secondary"
                      type="button"
                      disabled={spotifyBusy}
                      onClick={spotifyConnected ? disconnectSpotify : connectSpotify}
                    >
                      {spotifyBusy ? "PLEASE WAIT..." : spotifyConnected ? "DISCONNECT SPOTIFY" : "CONNECT SPOTIFY"}
                    </button>
                    <span>{spotifyConnected ? "CONNECTED" : "READ ACCESS ONLY"}</span>
                  </div>
                  {spotifyConnected && (
                    <form className="spotify-import-form" onSubmit={importSpotify}>
                      <input
                        required
                        value={spotifyUrl}
                        onChange={(e) => setSpotifyUrl(e.target.value)}
                        placeholder="Spotify playlist link"
                        aria-label="Spotify playlist link"
                      />
                      <button className="secondary" disabled={spotifyBusy}>
                        {spotifyBusy ? "IMPORTING..." : "IMPORT TRACKS"}
                      </button>
                    </form>
                  )}
                  {spotifyNotice && <div className="jf-count">{spotifyNotice}</div>}
                  {spotifySource && (
                    <p className="spotify-source">
                      Source playlist:{" "}
                      <a href={spotifySource.url} target="_blank" rel="noreferrer">
                        {spotifySource.name} - Spotify
                      </a>
                    </p>
                  )}
                </div>
              )}
              <div className="eyebrow">JELLYFIN MUSIC LIBRARY</div>{" "}
              {jfConnected ? (
                <>
                  <p>Connected. Search the Jellyfin library, add individual tracks, or import a Jellyfin playlist.</p>
                  <div className="jf-playlist-import">
                    <div className="eyebrow">IMPORT A JELLYFIN PLAYLIST</div>
                    <button className="secondary" type="button" disabled={jfBusy || game.round > 0} onClick={loadJellyfinPlaylists}>
                      {jfBusy ? "LOADING..." : "LOAD PLAYLISTS"}
                    </button>
                    {jfPlaylists.length > 0 && (
                      <form onSubmit={importJellyfinPlaylist}>
                        <select aria-label="Jellyfin playlist" value={jfPlaylistId} onChange={(e) => setJfPlaylistId(e.target.value)}>
                          {jfPlaylists.map((playlist) => (
                            <option key={playlist.id} value={playlist.id}>
                              {playlist.name} ? {playlist.trackCount} tracks
                            </option>
                          ))}
                        </select>
                        <button className="secondary" disabled={jfBusy || game.round > 0 || !jfPlaylistId}>
                          {jfBusy ? "IMPORTING..." : "IMPORT PLAYLIST"}
                        </button>
                      </form>
                    )}
                    {jfNotice && <div className="jf-count">{jfNotice}</div>}
                  </div>
                  <form className="jf-search" onSubmit={searchJellyfin}>
                    <input required value={jfQuery} onChange={(e) => setJfQuery(e.target.value)} placeholder="Search tracks or artists" />
                    <button className="secondary" disabled={jfBusy}>
                      {jfBusy ? "SEARCHING…" : "SEARCH"}
                    </button>
                  </form>
                  {jfResults.map((song) => (
                    <div className="jf-result" key={song.id}>
                      <span>
                        <strong>{song.title}</strong>
                        <small>
                          {song.artist}
                          {song.album ? ` · ${song.album}` : ""}
                        </small>
                      </span>
                      <button className="secondary" disabled={game.round > 0} onClick={() => addJellyfinSong(song.id)}>
                        ADD TO PLAYLIST
                      </button>
                    </div>
                  ))}
                </>
              ) : game.musicSource === "JELLYFIN" ? (
                <div className="jf-connect">
                  <p>Jellyfin is configured on this server, but it isn’t connected yet. Check the server connection.</p>
                  <button className="secondary" disabled={jfBusy} onClick={connectJellyfin}>
                    {jfBusy ? "CHECKING…" : "CHECK CONNECTION"}
                  </button>
                </div>
              ) : (
                <p>
                  Jellyfin isn’t configured. The server administrator can set JELLYFIN_URL, JELLYFIN_USERNAME, and JELLYFIN_PASSWORD in the
                  server environment.
                </p>
              )}
            </div>
          )}
          {host && game.round === 0 && <label className="round-count-control">ROUNDS TO PLAY
            <select value={game.maxRounds} onChange={(e) => void setRoundCount(Number(e.target.value))}>
              {Array.from({ length: 30 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>}
          {host ? (
            <button className="primary wide" onClick={() => act("start-round")}>
              {game.round === 0 ? "START THE FIRST ROUND" : `START ROUND ${game.round + 1}`} <span>→</span>
            </button>
          ) : (
            <div className="waiting">
              ✳ &nbsp; You’re in. {game.round === 0 ? "Waiting for the host to start." : `Waiting for round ${game.round + 1}.`}
            </div>
          )}
          {err && <div className="error">{err}</div>}

        </section>
      )}
      {game.status === "PLAYING" && (
        <section className="round-view">
          <div className="round-banner">
            <span>ROUND {game.round}</span>
            <span className="live">
              <i /> {tick > 0 ? "NOW PLAYING" : "TIME IS UP"} · {String(Math.floor(tick / 60)).padStart(2, "0")}:
              {String(tick % 60).padStart(2, "0")}
            </span>
          </div>
          {host ? (
            <>
              <div className="host-stage">
                <div className="record">◖</div>
                <div className="eyebrow">THE HOST'S TURNTABLE</div>
                <h1>{playing ? "A tune is in the air." : "Ready when you are."}</h1>
                <p>
                  {streamUrl
                    ? "Music is streamed by this app from Jellyfin to the host device."
                    : playing
                      ? "Let the pretend tune play. Let the guesses roll in."
                      : "Press play to start the music."}
                </p>
                <div className={`round-timer ${tick <= 10 ? "urgent" : ""}`}>
                  <span>TIME REMAINING</span>
                  <strong>
                    {String(Math.floor(tick / 60)).padStart(2, "0")}:{String(tick % 60).padStart(2, "0")}
                  </strong>
                </div>
                {streamUrl && (
                  <audio
                    className="audio-element"
                    ref={audioRef}
                    src={streamUrl}
                    preload="none"
                    onPlay={() => {
                      setPlaying(true);
                      void emit("set-music-playing", { playing: true });
                    }}
                    onPause={() => {
                      setPlaying(false);
                      void emit("set-music-playing", { playing: false });
                    }}
                  />
                )}
                <button className="primary play-control" disabled={tick <= 0} onClick={toggleMusic}>
                  {tick <= 0 ? "PLAY TIME IS UP" : playing ? "■ STOP MUSIC" : streamUrl ? "▶ PLAY THE SONG" : "▶ PLAY MOCK SONG"}
                </button>
                <div className="answer-count">
                  {answered} OF {participants.length} PLAYERS ANSWERED
                </div>
                <div className="locked-in-display">
                  <span>LOCKED IN</span>
                  {lockedPlayers.length ? (
                    lockedPlayers.map((p) => (
                      <div className="locked-in-player" key={p.id}>
                        <b>✓</b>
                        {p.name}
                      </div>
                    ))
                  ) : (
                    <small>No answers yet</small>
                  )}
                </div>
              </div>
              <button className="reveal-btn" onClick={() => act("reveal")}>
                REVEAL THE ANSWER <span>→</span>
              </button>
              {hasSubmitted ? (
                <div className="submitted"><div className="check">&#10003;</div><h1>Locked <em>in.</em></h1><p>Your answer is in. Waiting for the other players.</p></div>
              ) : (
                <form className="answer-form" onSubmit={submit}>
                  <div className="eyebrow">YOUR GUESS</div>
                  <p className="speed-bonus-note">Correct title: up to 1,000 points based on time remaining. Correct artist and exact year: 200 points each.</p>
                  <label>SONG TITLE<input required autoComplete="off" placeholder="Name that tune" value={answers.title} onChange={(e) => setAnswers({ ...answers, title: e.target.value })} /></label>
                  <label>ARTIST / BAND<input required autoComplete="off" placeholder="Who made it?" value={answers.artist} onChange={(e) => setAnswers({ ...answers, artist: e.target.value })} /></label>
                  <label>RELEASE YEAR<input inputMode="numeric" pattern="[0-9]{4}" placeholder="YYYY" value={answers.year} onChange={(e) => setAnswers({ ...answers, year: e.target.value })} /></label>
                  <button className="primary wide">LOCK IN MY ANSWER <span>&#8594;</span></button>
                </form>
              )}
            </>
          ) : (
            <>
              {hasSubmitted ? (
                <div className="submitted">
                  <div className="check">✓</div>
                  <h1>
                    Locked <em>in.</em>
                  </h1>
                  <p>Your answer is in the timeline. Keep your poker face.</p>
                  <div className="waiting-card">
                    {answered} OF {participants.length} ANSWERS IN <div className="dots">● &nbsp; ● &nbsp; ●</div>
                  </div>
                  <div className="locked-in-display">
                    <span>LOCKED IN</span>
                    {lockedPlayers.map((p) => (
                      <div className="locked-in-player" key={p.id}>
                        <b>✓</b>
                        {p.name}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <form className="answer-form" onSubmit={submit}>
                  <div className="eyebrow">TRUST YOUR EARS</div>
                  <p className="speed-bonus-note">Correct title: up to 1,000 points based on time remaining. Correct artist and exact year: 200 points each.</p>
                  <h1>
                    What’s the <em>track?</em>
                  </h1>
                  <label>
                    SONG TITLE
                    <input
                      required
                      autoComplete="off"
                      placeholder="Name that tune"
                      value={answers.title}
                      onChange={(e) => setAnswers({ ...answers, title: e.target.value })}
                    />
                  </label>
                  <label>
                    ARTIST / BAND
                    <input
                      required
                      autoComplete="off"
                      placeholder="Who made it?"
                      value={answers.artist}
                      onChange={(e) => setAnswers({ ...answers, artist: e.target.value })}
                    />
                  </label>
                  <label>
                    RELEASE YEAR
                    <input
                      inputMode="numeric"
                      pattern="[0-9]{4}"
                      placeholder="YYYY"
                      value={answers.year}
                      onChange={(e) => setAnswers({ ...answers, year: e.target.value })}
                    />
                  </label>
                  <button className="primary wide">
                    LOCK IN MY ANSWER <span>→</span>
                  </button>
                  <div className="locked-in-display">
                    <span>ALREADY LOCKED IN ({lockedPlayers.length})</span>
                    {lockedPlayers.length ? (
                      lockedPlayers.map((p) => (
                        <div className="locked-in-player" key={p.id}>
                          <b>✓</b>
                          {p.name}
                        </div>
                      ))
                    ) : (
                      <small>No answers yet</small>
                    )}
                  </div>
                </form>
              )}
            </>
          )}
          {err && <div className="error">{err}</div>}
        </section>
      )}
      {game.status === "REVEAL" && (
        <section className="reveal-view">
          <div className="eyebrow">THE MOMENT OF TRUTH · ROUND {game.round}</div>
          <h1>
            Were you <em>there?</em>
          </h1>
          <div className="answer-card">
            <span className="eyebrow">THE SONG WAS</span>
            <h2>{game.song?.title}</h2>
            <div className="artist">{game.song?.artist}</div>
            <div className="year">{game.song?.releaseYear || "Year unknown"}</div>
            {game.song?.spotifyUrl && (
              <a className="spotify-attribution" href={game.song.spotifyUrl} target="_blank" rel="noreferrer">
                Metadata from Spotify - View track
              </a>
            )}
          </div>
          {myResult && (
            <div className="your-score">
              <span>YOUR ROUND SCORE</span>
              <strong>+{myResult.points}</strong>
              <small>
                {myResult.title} · {myResult.artist} · {myResult.year || "—"}
              </small>
            </div>
          )}
          <div className="leaderboard">
            <div className="panel-head">
              <span>THE LEADERBOARD</span>
              <span>POINTS</span>
            </div>
            {sorted.map((p, i) => (
              <div className="player-row" key={p.id}>
                <span className="rank">{String(i + 1).padStart(2, "0")}</span>
                <span>{p.name}</span>
                <strong>{p.score}</strong>
              </div>
            ))}
          </div>
          {host && (
            <button className="primary wide" onClick={() => act("next-round")}>
              {game.round >= game.maxRounds ? "SEE FINAL RESULTS" : "NEXT ROUND"} <span>→</span>
            </button>
          )}
          {!host && <div className="waiting">✳ &nbsp; Waiting for the host to deal the next song.</div>}
        </section>
      )}
      {game.status === "GAME_OVER" && (
        <section className="reveal-view">
          <div className="eyebrow">THAT'S A WRAP</div>
          <h1>
            What a <em>set.</em>
          </h1>
          <div className="winner">✳ &nbsp; {sorted[0]?.name} takes the crown!</div>
          <div className="leaderboard">
            {sorted.map((p, i) => (
              <div className="player-row" key={p.id}>
                <span className="rank">{String(i + 1).padStart(2, "0")}</span>
                <span>{p.name}</span>
                <strong>{p.score}</strong>
              </div>
            ))}
          </div>
          {host && (
            <button className="primary wide" onClick={() => location.reload()}>
              START A NEW GAME ↗
            </button>
          )}
        </section>
      )}
      <footer className="app-footer">
        GOOD MUSIC. QUESTIONABLE YEAR ESTIMATES.{" "}
        <span>HOSTED BY {game.players.find((p) => p.id === game.players[0]?.id)?.name?.toUpperCase()}</span>
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
