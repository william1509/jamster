import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Server } from "socket.io";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { JellyfinMusicProvider, MockMusicProvider, type MusicProvider, type Song } from "./music";
import { scoreAnswer } from "./scoring";

type Player = { id: string; name: string; score: number; connected: boolean };
type Answer = { playerId: string; title: string; artist: string; year: number | null; points: number };
type Playlist = { id: string; name: string; songs: Song[] };
type Game = {
  code: string;
  hostId: string;
  status: string;
  players: Map<string, Player>;
  round: number;
  maxRounds: number;
  songId?: string;
  currentSong?: Song;
  streamUrl?: string;
  streamTicket?: string;
  roundEndsAt?: number;
  roundRemainingMs?: number;
  musicPlaying: boolean;
  provider: MusicProvider;
  playlists: Playlist[];
  selectedPlaylistId: string;
  gamePlaylistId?: string;
  answers: Map<string, Answer>;
  used: string[];
};
const games = new Map<string, Game>();
const prisma = new PrismaClient();
type SpotifyTokens = { accessToken: string; refreshToken: string; expiresAt: number };
const spotifyTokens = new Map<string, SpotifyTokens>();
const spotifyAuthStates = new Map<string, { verifier: string; hostId: string; origin: string; expiresAt: number }>();
const spotifyClientId = process.env.SPOTIFY_CLIENT_ID || "";
const spotifyRedirectUri = process.env.SPOTIFY_REDIRECT_URI || `http://localhost:${process.env.PORT || 3001}/api/spotify/callback`;
const spotifyTokenRequest = async (body: URLSearchParams) => {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !data.access_token) throw new Error(data.error_description || `Spotify authorization failed (${response.status}).`);
  return data;
};
const spotifyAccessToken = async (hostId: string) => {
  const tokens = spotifyTokens.get(hostId);
  if (!tokens) throw new Error("Connect Spotify before importing a playlist.");
  if (tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;
  const data = await spotifyTokenRequest(new URLSearchParams({
    client_id: spotifyClientId, grant_type: "refresh_token", refresh_token: tokens.refreshToken,
  }));
  tokens.accessToken = data.access_token!;
  if (data.refresh_token) tokens.refreshToken = data.refresh_token;
  tokens.expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  return tokens.accessToken;
};
const spotifyApi = async <T,>(hostId: string, url: string): Promise<T> => {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${await spotifyAccessToken(hostId)}` } });
  if (!response.ok) {
    if (response.status === 401) spotifyTokens.delete(hostId);
    if (response.status === 429) throw new Error(`Spotify rate limit reached. Try again in ${response.headers.get("retry-after") || "a few"} seconds.`);
    throw new Error(response.status === 403
      ? "Spotify could not access that playlist. It must be owned by or shared with the connected Spotify account."
      : `Spotify playlist request failed (${response.status}).`);
  }
  return await response.json() as T;
};
const spotifyPlaylistId = (input: string) => {
  const value = input.trim();
  const uri = value.match(/^spotify:playlist:([A-Za-z0-9]+)$/);
  if (uri) return uri[1];
  if (/^[A-Za-z0-9]{10,64}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (!["open.spotify.com", "www.open.spotify.com"].includes(url.hostname)) throw new Error();
    const match = url.pathname.match(/^\/playlist\/([A-Za-z0-9]+)\/?$/);
    if (match) return match[1];
  } catch { /* Invalid Spotify links receive the same input guidance below. */ }
  throw new Error("Paste a Spotify playlist link or playlist ID.");
};
const importSpotifyPlaylist = async (hostId: string, input: string) => {
  const id = spotifyPlaylistId(input);
  const playlist = await spotifyApi<{ name?: string }>(hostId, `https://api.spotify.com/v1/playlists/${encodeURIComponent(id)}`);
  const songs: Song[] = [];
  const seen = new Set<string>();
  for (let offset = 0; offset < 1000; offset += 50) {
    const page = await spotifyApi<{ items?: { item?: any; track?: any }[]; next?: string | null }>(
      hostId, `https://api.spotify.com/v1/playlists/${encodeURIComponent(id)}/items?limit=50&offset=${offset}`,
    );
    for (const entry of page.items || []) {
      const track = entry.item || entry.track;
      if (!track || track.type !== "track" || !track.id || seen.has(track.id)) continue;
      seen.add(track.id);
      const spotifyUrl = track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`;
      songs.push({
        id: `spotify:${track.id}`, provider: "spotify", providerTrackId: track.id, spotifyUrl,
        title: track.name || "Unknown title", artist: (track.artists || []).map((artist: { name?: string }) => artist.name).filter(Boolean).join(", ") || "Unknown artist",
        album: track.album?.name || "", releaseYear: Number.parseInt(track.album?.release_date || "", 10) || 0,
        artworkUrl: track.album?.images?.[0]?.url, duration: track.duration_ms ? Math.round(track.duration_ms / 1000) : undefined,
      });
    }
    if (offset === 950 && page.next) throw new Error("Spotify imports are limited to the first 1,000 playlist tracks.");
    if (!page.next) break;
  }
  if (!songs.length) throw new Error("No playable tracks were found in that Spotify playlist.");
  return { name: playlist.name || "Spotify Playlist", url: `https://open.spotify.com/playlist/${id}`, songs };
};
const playlistStorageError = (error: unknown) => {
  const message = (error as Error)?.message || "Unknown database error";
  if (message.includes("P1001") || message.includes("Can't reach database server"))
    return "PostgreSQL is unavailable. Start PostgreSQL (for this project, run `docker compose up -d postgres`) and try again.";
  if (message.includes("P2021") || message.includes("does not exist"))
    return "Playlist tables are missing. Start PostgreSQL, then run `npm run db:push`.";
  return message;
};
const configuredJellyfin = Boolean(process.env.JELLYFIN_URL && process.env.JELLYFIN_USERNAME && process.env.JELLYFIN_PASSWORD);
const jellyfinProvider = configuredJellyfin
  ? new JellyfinMusicProvider(process.env.JELLYFIN_URL!, process.env.JELLYFIN_USERNAME!, process.env.JELLYFIN_PASSWORD!)
  : undefined;
let jellyfinReady = false;
const streamTickets = new Map<string, { url: string; expiresAt: number }>();
if (jellyfinProvider) {
  void jellyfinProvider.connect().then(() => { jellyfinReady = true; console.log("Jellyfin connected"); })
    .catch((error: unknown) => console.error("Jellyfin connection failed:", (error as Error).message));
}
const app = express();
app.use(cors());
app.use(express.json());
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/api/spotify/callback", async (req, res) => {
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const pending = spotifyAuthStates.get(state);
  if (state) spotifyAuthStates.delete(state);
  let ok = false;
  let message = "Spotify could not complete authorization. Close this window and try again.";
  if (pending && pending.expiresAt > Date.now() && typeof req.query.code === "string") {
    try {
      const data = await spotifyTokenRequest(new URLSearchParams({
        client_id: spotifyClientId, grant_type: "authorization_code", code: req.query.code,
        redirect_uri: spotifyRedirectUri, code_verifier: pending.verifier,
      }));
      if (!data.refresh_token) throw new Error("Spotify did not return a refresh token. Reconnect and approve playlist access.");
      spotifyTokens.set(pending.hostId, {
        accessToken: data.access_token!, refreshToken: data.refresh_token,
        expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
      });
      ok = true;
      message = "Spotify connected. You can close this window.";
    } catch (error) { message = (error as Error).message; }
  } else if (pending && req.query.error) {
    message = "Spotify access was cancelled.";
  }
  let targetOrigin = "";
  try { targetOrigin = pending ? new URL(pending.origin).origin : ""; } catch { /* Invalid opener origins are never used as message targets. */ }
  if (!targetOrigin) return res.status(400).send("Spotify authorization could not be matched to the app. Close this window and try again.");
  const payload = JSON.stringify({ type: "spotify-auth-complete", ok, message }).replace(/</g, "\\u003c");
  res.type("html").send(`<!doctype html><meta charset="utf-8"><title>Spotify connection</title><p>${ok ? "Connected." : "Connection failed."} This window should close automatically.</p><script>window.opener?.postMessage(${payload},${JSON.stringify(targetOrigin)});window.close()</script>`);
});
app.get("/api/music/stream/:ticket", async (req, res) => {
  const stream = streamTickets.get(req.params.ticket);
  if (!stream || stream.expiresAt < Date.now()) {
    streamTickets.delete(req.params.ticket);
    return res.status(404).end();
  }
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), Math.max(0, stream.expiresAt - Date.now()));
  res.on("close", () => controller.abort());
  try {
    const headers: Record<string, string> = {};
    if (req.header("range")) headers.Range = req.header("range")!;
    const upstream = await fetch(stream.url, { headers, signal: controller.signal });
    res.status(upstream.status);
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"] as const) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    if (!upstream.body) return res.end();
    try {
      await pipeline(Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream), res, { signal: controller.signal });
    } catch { if (!res.destroyed) res.end(); }
  } catch {
    if (!res.headersSent) res.status(502).json({ error: "Could not read the Jellyfin stream." });
    else res.end();
  } finally { clearTimeout(abortTimer); }
});
app.use(express.static("dist"));
app.get("*", (_req, res, next) => {
  if (_req.path.startsWith("/api/")) return next();
  res.sendFile("index.html", { root: "dist" }, (error) => { if (error) next(); });
});
const http = createServer(app),
  io = new Server(http, { cors: { origin: true, credentials: true } });
const code = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...randomBytes(4)].map((b) => chars[b % chars.length]).join("");
};
const safeGame = (g: Game, reveal = false) => ({
  code: g.code,
  status: g.status,
  round: g.round,
  maxRounds: g.maxRounds,
  players: [...g.players.values()].map((p) => ({ id: p.id, name: p.name, score: p.score, connected: p.connected })),
  answered: g.answers.size,
  answeredPlayers: [...g.answers.keys()],
  song: reveal ? g.currentSong : undefined,
  playlists: g.playlists.map((p) => ({ id: p.id, name: p.name, trackCount: p.songs.length })),
  selectedPlaylistId: g.gamePlaylistId || g.selectedPlaylistId,
  roundEndsAt: g.roundEndsAt,
  roundTimeRemainingMs: g.roundEndsAt ? Math.max(0, g.roundEndsAt - Date.now()) : g.roundRemainingMs,
  musicPlaying: g.musicPlaying,
  musicSource: g.provider instanceof JellyfinMusicProvider ? "JELLYFIN" : "MOCK",
  jellyfinAvailable: jellyfinReady,
  results: reveal
    ? [...g.answers.values()].map((a) => ({ playerId: a.playerId, title: a.title, artist: a.artist, year: a.year, points: a.points }))
    : undefined,
});
const codeSchema = z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z2-9]{4}$/),
  nameSchema = z.string().trim().min(1).max(20),
  answerSchema = z.object({
    title: z.string().trim().max(100),
    artist: z.string().trim().max(100),
    year: z.number().int().min(1900).max(2100).nullable(),
  });
io.on("connection", (socket) => {
  let identity: { game: Game; playerId: string; host: boolean } | undefined;
  socket.on("create-game", async (payload: { name?: string }, cb: (x: any) => void) => {
    try {
      const name = nameSchema.safeParse(payload?.name ?? "Host");
      if (!name.success) return cb({ error: "Choose a name up to 20 characters." });
      const savedPlaylists = await prisma.playlist.findMany({
        orderBy: { createdAt: "asc" },
        include: { songs: { orderBy: { position: "asc" }, include: { song: true } } },
      });
      let c = code();
      while (games.has(c)) c = code();
      const id = randomUUID(),
        g: Game = {
          code: c,
          hostId: id,
          status: "LOBBY",
          players: new Map([[id, { id, name: name.data, score: 0, connected: true }]]),
          round: 0,
          musicPlaying: false,
          maxRounds: 10,
          answers: new Map(),
          used: [],
          provider: jellyfinProvider || new MockMusicProvider(),
          playlists: savedPlaylists.map((playlist) => ({
              id: playlist.id,
              name: playlist.name,
              songs: playlist.songs.map(({ song }) => ({
                id: song.id,
                provider: song.provider === "jellyfin" ? "jellyfin" as const : song.provider === "spotify" ? "spotify" as const : "mock" as const,
                providerTrackId: song.providerTrackId || undefined,
                spotifyUrl: song.spotifyUrl || undefined,
                title: song.title,
                artist: song.artist,
                album: song.album,
                releaseYear: song.releaseYear,
                artworkUrl: song.artworkUrl || undefined,
                duration: song.duration || undefined,
              })),
            })),
          selectedPlaylistId: savedPlaylists[0]?.id || "",
        };
      games.set(c, g);
      identity = { game: g, playerId: id, host: true };
      socket.join(c);
      cb({ game: safeGame(g), playerId: id });
      io.to(c).emit("game-state", safeGame(g));
    } catch (e) {
      cb({ error: `Could not load saved playlists: ${playlistStorageError(e)}` });
    }
  });
  socket.on("join-game", (payload: { code?: string; name?: string; playerId?: string }, cb: (x: any) => void) => {
    const c = codeSchema.safeParse(payload?.code),
      name = nameSchema.safeParse(payload?.name ?? "");
    if (!c.success || !name.success) return cb({ error: "Enter a valid four character code and a name." });
    const g = games.get(c.data);
    if (!g) return cb({ error: "Room not found. Check the code and try again." });
    if (g.status === "GAME_OVER") return cb({ error: "This game has ended." });
    let p = payload.playerId ? g.players.get(payload.playerId) : undefined;
    if (!p) {
      const id = randomUUID();
      p = { id, name: name.data, score: 0, connected: true };
      g.players.set(id, p);
    }
    p.connected = true;
    identity = { game: g, playerId: p.id, host: p.id === g.hostId };
    socket.join(c.data);
    cb({ game: safeGame(g), playerId: p.id });
    if (identity.host && g.status === "PLAYING") socket.emit("host-track", { streamUrl: g.streamUrl, simulated: !g.streamUrl, roundEndsAt: g.roundEndsAt });
    io.to(c.data).emit("game-state", safeGame(g));
  });
  const auth = (host = false) => {
    if (!identity) throw new Error("Join a room first");
    if (host && !identity.host) throw new Error("Only the host can do that");
    return identity.game;
  };
  socket.on("set-round-count", (payload: { count?: number }, cb: (x: any) => void) => {
    try {
      const g = auth(true);
      if (g.round > 0 || g.status !== "LOBBY") throw new Error("The round count is locked after the game starts.");
      g.maxRounds = z.number().int().min(1).max(30).parse(payload?.count);
      io.to(g.code).emit("game-state", safeGame(g));
      cb({ ok: true });
    } catch (e) { cb({ error: (e as Error).message }); }
  });
  const beginRound = (g: Game) => {
    if (g.round === 0) g.gamePlaylistId = g.selectedPlaylistId;
    const playlist = g.playlists.find((item) => item.id === g.gamePlaylistId);
    if (!playlist) throw new Error("Create a playlist, then select it before starting the game.");
    if (!playlist.songs.length) throw new Error("Add at least one song to the selected playlist before starting.");
    const pool = playlist.songs.filter((song) => !g.used.includes(song.id));
    if (!pool.length) g.used = [];
    const available = playlist.songs.filter((song) => !g.used.includes(song.id));
    const song = available[Math.floor(Math.random() * available.length)];
    g.used.push(song.id);
    g.round++;
    g.songId = song.id;
    g.currentSong = song;
    g.roundEndsAt = Date.now() + 60_000;
    g.roundRemainingMs = 60_000;
    g.musicPlaying = false;
    const jellyfinUrl = g.provider.getStreamUrl(song);
    if (jellyfinUrl) {
      for (const [ticket, value] of streamTickets) if (value.expiresAt < Date.now()) streamTickets.delete(ticket);
      const ticket = randomBytes(32).toString("hex");
      streamTickets.set(ticket, { url: jellyfinUrl, expiresAt: g.roundEndsAt });
      g.streamTicket = ticket;
      g.streamUrl = `/api/music/stream/${ticket}`;
    } else { g.streamTicket = undefined; g.streamUrl = undefined; }
    g.answers.clear();
    g.status = "PLAYING";
    io.to(g.code).emit("game-state", safeGame(g));
    socket.emit("host-track", { streamUrl: g.streamUrl, simulated: !g.streamUrl, roundEndsAt: g.roundEndsAt });
  };
  socket.on("library-jellyfin-connect", (_payload: unknown, cb: (x: any) => void) => {
    if (!jellyfinProvider) return cb({ error: "Jellyfin is not configured on this server." });
    if (!jellyfinReady) return cb({ error: "The server could not connect to Jellyfin. Check its connection and credentials." });
    cb({ ok: true });
  });
  socket.on("library-jellyfin-playlists", async (_payload: unknown, cb: (x: any) => void) => {
    try {
      if (!(jellyfinProvider instanceof JellyfinMusicProvider) || !jellyfinReady) throw new Error("Jellyfin is not available on this server.");
      cb({ playlists: await jellyfinProvider.listPlaylists() });
    } catch (e) { cb({ error: (e as Error).message }); }
  });
  socket.on("library-jellyfin-search", async (payload: { query?: string }, cb: (x: any) => void) => {
    try {
      if (!(jellyfinProvider instanceof JellyfinMusicProvider) || !jellyfinReady) throw new Error("Jellyfin is not available on this server.");
      const query = z.string().trim().min(1).max(100).parse(payload?.query || "");
      cb({ songs: await jellyfinProvider.searchSongs(query) });
    } catch (e) { cb({ error: (e as Error).message }); }
  });
  const appendLibrarySongs = async (playlistId: string, importedSongs: Song[]) => {
    const playlist = await prisma.playlist.findUnique({ where: { id: playlistId }, include: { songs: true } });
    if (!playlist) throw new Error("Create or select a playlist first.");
    const present = new Set(playlist.songs.map((entry) => entry.songId));
    const additions = importedSongs.filter((song) => {
      if (present.has(song.id)) return false;
      present.add(song.id);
      return true;
    });
    await prisma.$transaction(async (tx) => {
      for (const [index, song] of additions.entries()) {
        await tx.song.upsert({
          where: { id: song.id },
          create: {
            id: song.id, provider: song.provider, providerTrackId: song.providerTrackId || null,
            spotifyUrl: song.spotifyUrl || null, title: song.title, artist: song.artist, album: song.album,
            releaseYear: song.releaseYear, artworkUrl: song.artworkUrl || null, duration: song.duration || null,
          },
          update: {
            provider: song.provider, providerTrackId: song.providerTrackId || null,
            spotifyUrl: song.spotifyUrl || null, title: song.title, artist: song.artist, album: song.album,
            releaseYear: song.releaseYear, artworkUrl: song.artworkUrl || null, duration: song.duration || null,
          },
        });
        await tx.playlistSong.create({ data: { playlistId, songId: song.id, position: playlist.songs.length + index } });
      }
    });
    return { importedCount: additions.length, totalCount: playlist.songs.length + additions.length };
  };
  socket.on("library-jellyfin-import-playlist", async (payload: { playlistId?: string; id?: string }, cb: (x: any) => void) => {
    try {
      if (!(jellyfinProvider instanceof JellyfinMusicProvider) || !jellyfinReady) throw new Error("Jellyfin is not available on this server.");
      const playlistId = z.string().min(1).max(100).parse(payload?.playlistId || "");
      const id = z.string().trim().min(1).max(100).parse(payload?.id || "");
      const imported = await jellyfinProvider.getPlaylistSongs(id);
      if (!imported.length) throw new Error("That Jellyfin playlist has no music tracks.");
      cb({ ok: true, ...await appendLibrarySongs(playlistId, imported) });
    } catch (e) { cb({ error: playlistStorageError(e) }); }
  });
  socket.on("library-jellyfin-add-song", async (payload: { playlistId?: string; id?: string }, cb: (x: any) => void) => {
    try {
      if (!(jellyfinProvider instanceof JellyfinMusicProvider) || !jellyfinReady) throw new Error("Jellyfin is not available on this server.");
      const playlistId = z.string().min(1).max(100).parse(payload?.playlistId || "");
      const id = z.string().min(1).max(100).parse(payload?.id || "");
      const result = await appendLibrarySongs(playlistId, [await jellyfinProvider.getSong(id)]);
      cb({ ok: true, ...result });
    } catch (e) { cb({ error: playlistStorageError(e) }); }
  });
  socket.on("jellyfin-connect", (_payload: unknown, cb: (x: any) => void) => {
    try {
      const g = auth(true);
      if (!jellyfinProvider) throw new Error("Jellyfin is not configured on this server. Set JELLYFIN_URL, JELLYFIN_USERNAME, and JELLYFIN_PASSWORD, then restart it.");
      if (!jellyfinReady) throw new Error("The server could not connect to Jellyfin. Check its backend URL and credentials, then restart it.");
      cb({ ok: true });
      io.to(g.code).emit("game-state", safeGame(g));
    } catch (e) { cb({ error: (e as Error).message }); }
  });
  socket.on("jellyfin-search", async (payload: { query?: string }, cb: (x: any) => void) => {
    try {
      const g = auth(true);
      if (!(g.provider instanceof JellyfinMusicProvider) || !jellyfinReady) throw new Error("Jellyfin is not available on this server.");
      const query = z.string().trim().min(1).max(100).parse(payload?.query || "");
      cb({ songs: await g.provider.searchSongs(query) });
    } catch (e) { cb({ error: (e as Error).message }); }
  });
  socket.on("jellyfin-playlists", async (_payload: unknown, cb: (x: any) => void) => {
    try {
      const g = auth(true);
      if (!(g.provider instanceof JellyfinMusicProvider) || !jellyfinReady) throw new Error("Jellyfin is not available on this server.");
      cb({ playlists: await g.provider.listPlaylists() });
    } catch (e) { cb({ error: (e as Error).message }); }
  });
  socket.on("jellyfin-import-playlist", async (payload: { id?: string }, cb: (x: any) => void) => {
    try {
      const g = auth(true);
      if (!(g.provider instanceof JellyfinMusicProvider) || !jellyfinReady) throw new Error("Jellyfin is not available on this server.");
      if (g.round > 0) throw new Error("Playlist tracks are locked after the first round starts.");
      const playlist = g.playlists.find((item) => item.id === g.selectedPlaylistId);
      if (!playlist) throw new Error("Create or select a playlist before importing Jellyfin tracks.");
      const id = z.string().trim().min(1).max(100).parse(payload?.id || "");
      const imported = await g.provider.getPlaylistSongs(id);
      if (!imported.length) throw new Error("That Jellyfin playlist has no music tracks.");
      const currentIds = new Set(playlist.songs.map((song) => song.id));
      const additions = imported.filter((song) => {
        if (currentIds.has(song.id)) return false;
        currentIds.add(song.id);
        return true;
      });
      await prisma.$transaction(async (tx) => {
        for (const [index, song] of additions.entries()) {
          await tx.song.upsert({
            where: { id: song.id },
            create: {
              id: song.id, provider: song.provider, providerTrackId: song.providerTrackId || null,
              title: song.title, artist: song.artist, album: song.album, releaseYear: song.releaseYear,
              artworkUrl: song.artworkUrl || null, duration: song.duration || null,
            },
            update: {
              provider: song.provider, providerTrackId: song.providerTrackId || null,
              title: song.title, artist: song.artist, album: song.album, releaseYear: song.releaseYear,
              artworkUrl: song.artworkUrl || null, duration: song.duration || null,
            },
          });
          await tx.playlistSong.create({ data: { playlistId: playlist.id, songId: song.id, position: playlist.songs.length + index } });
        }
      });
      playlist.songs.push(...additions);
      cb({ ok: true, importedCount: additions.length, totalCount: playlist.songs.length });
      io.to(g.code).emit("game-state", safeGame(g));
    } catch (e) { cb({ error: playlistStorageError(e) }); }
  });
  socket.on("spotify-status", (payload: { libraryId?: string }, cb: (x: any) => void) => {
    try {
      const hostId = payload?.libraryId ? z.string().min(8).max(100).parse(payload.libraryId) : (auth(true), identity!.playerId);
      cb({ connected: spotifyTokens.has(hostId), configured: Boolean(spotifyClientId) });
    }
    catch (e) { cb({ error: (e as Error).message }); }
  });
  socket.on("spotify-auth-url", (payload: { libraryId?: string }, cb: (x: any) => void) => {
    try {
      const hostId = payload?.libraryId ? z.string().min(8).max(100).parse(payload.libraryId) : (auth(true), identity!.playerId);
      if (!spotifyClientId) throw new Error("Set SPOTIFY_CLIENT_ID in the server environment and restart the app.");
      const redirect = new URL(spotifyRedirectUri);
      if (!(["http:", "https:"].includes(redirect.protocol))) throw new Error("SPOTIFY_REDIRECT_URI must use HTTP or HTTPS.");
      for (const [key, pending] of spotifyAuthStates) if (pending.expiresAt < Date.now()) spotifyAuthStates.delete(key);
      const state = randomBytes(24).toString("hex");
      const verifier = randomBytes(48).toString("base64url");
      const rawOrigin = socket.handshake.headers.origin;
      const origin = typeof rawOrigin === "string" ? new URL(rawOrigin).origin : redirect.origin;
      spotifyAuthStates.set(state, { verifier, hostId, origin, expiresAt: Date.now() + 10 * 60_000 });
      const authorize = new URL("https://accounts.spotify.com/authorize");
      authorize.search = new URLSearchParams({
        response_type: "code", client_id: spotifyClientId, redirect_uri: spotifyRedirectUri,
        scope: "playlist-read-private playlist-read-collaborative", state,
        code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      }).toString();
      cb({ url: authorize.toString(), callbackOrigin: redirect.origin });
    } catch (e) { cb({ error: (e as Error).message }); }
  });
  socket.on("spotify-disconnect", (payload: { libraryId?: string }, cb: (x: any) => void) => {
    try {
      const hostId = payload?.libraryId ? z.string().min(8).max(100).parse(payload.libraryId) : (auth(true), identity!.playerId);
      spotifyTokens.delete(hostId);
      cb({ ok: true });
    }
    catch (e) { cb({ error: (e as Error).message }); }
  });
  socket.on("spotify-import", async (payload: { url?: string; playlistId?: string; libraryId?: string }, cb: (x: any) => void) => {
    try {
      const hostId = payload?.libraryId ? z.string().min(8).max(100).parse(payload.libraryId) : (auth(true), identity!.playerId);
      const playlistId = z.string().min(1).max(100).parse(payload?.playlistId || "");
      const playlist = await prisma.playlist.findUnique({ where: { id: playlistId }, include: { songs: true } });
      if (!playlist) throw new Error("Create or select a playlist before importing Spotify tracks.");
      const imported = await importSpotifyPlaylist(hostId, z.string().trim().min(1).max(500).parse(payload?.url || ""));
      const currentIds = new Set(playlist.songs.map((song) => song.songId));
      const additions = imported.songs.filter((song) => !currentIds.has(song.id));
      await prisma.$transaction(async (tx) => {
        for (const [index, song] of additions.entries()) {
          await tx.song.upsert({
            where: { id: song.id },
            create: {
              id: song.id, provider: song.provider, providerTrackId: song.providerTrackId || null, spotifyUrl: song.spotifyUrl || null,
              title: song.title, artist: song.artist, album: song.album, releaseYear: song.releaseYear,
              artworkUrl: song.artworkUrl || null, duration: song.duration || null,
            },
            update: {
              provider: song.provider, providerTrackId: song.providerTrackId || null, spotifyUrl: song.spotifyUrl || null,
              title: song.title, artist: song.artist, album: song.album, releaseYear: song.releaseYear,
              artworkUrl: song.artworkUrl || null, duration: song.duration || null,
            },
          });
          await tx.playlistSong.create({ data: { playlistId, songId: song.id, position: playlist.songs.length + index } });
        }
      });
      cb({ ok: true, playlistName: imported.name, playlistUrl: imported.url, importedCount: additions.length, totalCount: playlist.songs.length + additions.length });
    } catch (e) { cb({ error: playlistStorageError(e) }); }
  });
  socket.on("list-playlists", async (_payload: unknown, cb: (x: any) => void) => {
    try {
      const playlists = await prisma.playlist.findMany({
        orderBy: { createdAt: "asc" },
        include: { songs: { orderBy: { position: "asc" }, include: { song: true } } },
      });
      cb({ playlists: playlists.map((playlist) => ({ id: playlist.id, name: playlist.name, songs: playlist.songs.map(({ song }) => ({
        id: song.id, title: song.title, artist: song.artist, album: song.album, releaseYear: song.releaseYear,
      })) })) });
    } catch (e) { cb({ error: playlistStorageError(e) }); }
  });
  socket.on("create-playlist", async (payload: { name?: string }, cb: (x: any) => void) => {
    try {
      const name = z.string().trim().min(1).max(32).parse(payload?.name || "");
      const saved = await prisma.playlist.create({ data: { name } });
      cb({ ok: true, playlist: { id: saved.id, name: saved.name, songs: [] } });
    } catch (e) { cb({ error: playlistStorageError(e) }); }
  });
  socket.on("rename-playlist", async (payload: { id?: string; name?: string }, cb: (x: any) => void) => {
    try {
      const id = z.string().min(1).max(100).parse(payload?.id || "");
      const name = z.string().trim().min(1).max(32).parse(payload?.name || "");
      await prisma.playlist.update({ where: { id }, data: { name } });
      cb({ ok: true });
    } catch (e) { cb({ error: playlistStorageError(e) }); }
  });
  socket.on("delete-playlist", async (payload: { id?: string }, cb: (x: any) => void) => {
    try {
      const id = z.string().min(1).max(100).parse(payload?.id || "");
      await prisma.playlist.delete({ where: { id } });
      cb({ ok: true });
    } catch (e) { cb({ error: playlistStorageError(e) }); }
  });
  socket.on("add-playlist-song", async (payload: { playlistId?: string; title?: string; artist?: string; album?: string; year?: number }, cb: (x: any) => void) => {
    try {
      const playlistId = z.string().min(1).max(100).parse(payload?.playlistId || "");
      const title = z.string().trim().min(1).max(100).parse(payload?.title || "");
      const artist = z.string().trim().min(1).max(100).parse(payload?.artist || "");
      const album = z.string().trim().max(100).parse(payload?.album || "");
      const releaseYear = z.number().int().min(1900).max(2100).parse(payload?.year);
      const id = `manual:${randomUUID()}`;
      await prisma.$transaction(async (tx) => {
        await tx.song.create({ data: { id, provider: "manual", title, artist, album, releaseYear } });
        const position = await tx.playlistSong.aggregate({ where: { playlistId }, _max: { position: true } });
        await tx.playlistSong.create({ data: { playlistId, songId: id, position: (position._max.position ?? -1) + 1 } });
      });
      cb({ ok: true });
    } catch (e) { cb({ error: playlistStorageError(e) }); }
  });
  socket.on("remove-playlist-song", async (payload: { playlistId?: string; songId?: string }, cb: (x: any) => void) => {
    try {
      const playlistId = z.string().min(1).max(100).parse(payload?.playlistId || "");
      const songId = z.string().min(1).max(200).parse(payload?.songId || "");
      await prisma.playlistSong.delete({ where: { playlistId_songId: { playlistId, songId } } });
      cb({ ok: true });
    } catch (e) { cb({ error: playlistStorageError(e) }); }
  });
  socket.on("select-playlist", (payload: { id?: string }, cb: (x: any) => void) => {
    try {
      const g = auth(true);
      if (g.round > 0) throw new Error("The game playlist is locked after the first round starts.");
      const id = z.string().min(1).max(100).parse(payload?.id || "");
      if (!g.playlists.some((playlist) => playlist.id === id)) throw new Error("Playlist not found.");
      g.selectedPlaylistId = id;
      cb({ ok: true });
      io.to(g.code).emit("game-state", safeGame(g));
    } catch (e) { cb({ error: (e as Error).message }); }
  });
  socket.on("jellyfin-add-song", async (payload: { id?: string }, cb: (x: any) => void) => {
    try {
      const g = auth(true);
      if (!(g.provider instanceof JellyfinMusicProvider) || !jellyfinReady) throw new Error("Jellyfin is not available on this server.");
      if (g.round > 0) throw new Error("Playlist tracks are locked after the first round starts.");
      const id = z.string().min(1).max(100).parse(payload?.id || "");
      const song = await g.provider.getSong(id);
      const playlist = g.playlists.find((item) => item.id === g.selectedPlaylistId);
      if (!playlist) throw new Error("Create or select a playlist first.");
      if (!playlist.songs.some((item) => item.id === song.id)) {
        await prisma.song.upsert({
          where: { id: song.id },
          create: {
            id: song.id, provider: song.provider, providerTrackId: song.providerTrackId || null,
            title: song.title, artist: song.artist, album: song.album, releaseYear: song.releaseYear,
            artworkUrl: song.artworkUrl || null, duration: song.duration || null,
          },
          update: {
            provider: song.provider, providerTrackId: song.providerTrackId || null,
            title: song.title, artist: song.artist, album: song.album, releaseYear: song.releaseYear,
            artworkUrl: song.artworkUrl || null, duration: song.duration || null,
          },
        });
        const key = { playlistId_songId: { playlistId: playlist.id, songId: song.id } };
        if (!(await prisma.playlistSong.findUnique({ where: key }))) {
          const current = await prisma.playlistSong.aggregate({ where: { playlistId: playlist.id }, _max: { position: true } });
          await prisma.playlistSong.create({ data: { playlistId: playlist.id, songId: song.id, position: (current._max.position ?? -1) + 1 } });
        }
        playlist.songs.push(song);
      }
      cb({ ok: true, count: playlist.songs.length });
      io.to(g.code).emit("game-state", safeGame(g));
    } catch (e) { cb({ error: playlistStorageError(e) }); }
  });
  socket.on("start-game", (_p: any, cb: (x: any) => void) => {
    try {
      const g = auth(true);
      if ([...g.players.values()].filter((p) => p.connected).length < 2) throw new Error("Invite at least one player first.");
      g.round = 0;
      g.status = "LOBBY";
      io.to(g.code).emit("game-state", safeGame(g));
      cb({ ok: true });
    } catch (e) {
      cb({ error: (e as Error).message });
    }
  });
  socket.on("start-round", (_p: any, cb: (x: any) => void) => {
    try {
      const g = auth(true);
      if (g.round >= g.maxRounds) {
        g.status = "GAME_OVER";
        io.to(g.code).emit("game-state", safeGame(g));
        return cb({ ok: true });
      }
      beginRound(g);
      cb({ ok: true });
    } catch (e) {
      cb({ error: (e as Error).message });
    }
  });
  socket.on("set-music-playing", (payload: { playing?: boolean }, cb: (x: any) => void) => {
    try {
      const g = auth(true);
      if (g.status !== "PLAYING") throw new Error("There is no active round.");
      const playing = Boolean(payload?.playing);
      if (playing === g.musicPlaying) return cb({ ok: true });
      if (playing) {
        const remaining = g.roundRemainingMs ?? (g.roundEndsAt ? Math.max(0, g.roundEndsAt - Date.now()) : 0);
        if (remaining <= 0) return cb({ ok: true });
        g.roundRemainingMs = remaining;
        g.roundEndsAt = Date.now() + remaining;
      } else {
        g.roundRemainingMs = g.roundEndsAt ? Math.max(0, g.roundEndsAt - Date.now()) : (g.roundRemainingMs ?? 0);
        g.roundEndsAt = undefined;
      }
      g.musicPlaying = playing;
      io.to(g.code).emit("game-state", safeGame(g));
      cb({ ok: true });
    } catch (e) { cb({ error: (e as Error).message }); }
  });
  socket.on("submit-answer", (payload: any, cb: (x: any) => void) => {
    try {
      const g = auth();
      if (g.status !== "PLAYING") throw new Error("Answers are closed.");
      if (g.answers.has(identity!.playerId)) throw new Error("You already submitted.");
      const parsed = answerSchema.safeParse(payload);
      if (!parsed.success) throw new Error("Check your answer and try again.");
      const song = g.currentSong!;
      const remainingTimeMs = g.roundEndsAt
        ? Math.max(0, g.roundEndsAt - Date.now())
        : Math.max(0, g.roundRemainingMs ?? 0);
      const points = scoreAnswer(parsed.data, song, remainingTimeMs);
      g.answers.set(identity!.playerId, { playerId: identity!.playerId, ...parsed.data, points });
      g.players.get(identity!.playerId)!.score += points;
      cb({ ok: true });
      io.to(g.code).emit("answer-locked", { playerId: identity!.playerId });
      const everyoneAnswered = [...g.players.values()].filter((p) => p.connected).every((p) => g.answers.has(p.id));
      if (everyoneAnswered) {
        g.status = "REVEAL";
        if (g.streamTicket) streamTickets.delete(g.streamTicket);
        g.streamTicket = undefined;
        g.streamUrl = undefined;
        g.roundEndsAt = undefined;
        g.roundRemainingMs = undefined;
        g.musicPlaying = false;
        io.to(g.code).emit("game-state", safeGame(g, true));
        io.to(g.code).emit("all-answered");
      } else {
        io.to(g.code).emit("game-state", safeGame(g));
      }
    } catch (e) {
      cb({ error: (e as Error).message });
    }
  });
  socket.on("reveal", (_p: any, cb: (x: any) => void) => {
    try {
      const g = auth(true);
      if (g.status !== "PLAYING") throw new Error("There is no active round.");
      g.status = "REVEAL";
      if (g.streamTicket) streamTickets.delete(g.streamTicket);
      g.streamTicket = undefined;
      g.streamUrl = undefined;
      g.roundEndsAt = undefined;
      g.roundRemainingMs = undefined;
      g.musicPlaying = false;
      io.to(g.code).emit("game-state", safeGame(g, true));
      cb({ ok: true });
    } catch (e) {
      cb({ error: (e as Error).message });
    }
  });
  socket.on("stop-game", (_p: any, cb: (x: any) => void) => {
    try {
      const g = auth(true);
      if (g.status === "GAME_OVER") throw new Error("This game has already ended.");
      g.status = "GAME_OVER";
      if (g.streamTicket) streamTickets.delete(g.streamTicket);
      g.streamTicket = undefined;
      g.streamUrl = undefined;
      g.roundEndsAt = undefined;
      g.roundRemainingMs = undefined;
      g.musicPlaying = false;
      io.to(g.code).emit("game-state", safeGame(g, Boolean(g.currentSong)));
      cb({ ok: true });
    } catch (e) { cb({ error: (e as Error).message }); }
  });
  socket.on("next-round", (_p: any, cb: (x: any) => void) => {
    try {
      const g = auth(true);
      if (g.status !== "REVEAL") throw new Error("Reveal the answer first.");
      if (g.round >= g.maxRounds) {
        g.status = "GAME_OVER";
        g.playlists = [];
        g.streamUrl = undefined;
        g.streamTicket = undefined;
        g.roundEndsAt = undefined;
        g.roundRemainingMs = undefined;
        g.musicPlaying = false;
        io.to(g.code).emit("game-state", safeGame(g, true));
      } else {
        beginRound(g);
      }
      cb({ ok: true });
    } catch (e) {
      cb({ error: (e as Error).message });
    }
  });
  socket.on("disconnect", () => {
    if (!identity) return;
    const g = identity.game,
      p = g.players.get(identity.playerId);
    if (p) p.connected = false;
    io.to(g.code).emit("game-state", safeGame(g));
    if (![...g.players.values()].some((player) => player.connected))
      setTimeout(
        () => {
          if (![...g.players.values()].some((player) => player.connected)) {
            games.delete(g.code);
          }
        },
        60 * 60 * 1000,
      );
  });
});
const port = Number(process.env.PORT) || 3001;
http.listen(port, "0.0.0.0", () => console.log(`Side A server listening on ${port}`));
