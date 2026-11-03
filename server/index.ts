import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { createServer } from "node:http";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Server } from "socket.io";
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { JellyfinMusicProvider, MockMusicProvider, type MusicProvider, type Song } from "./music";
import { scoreAnswer } from "./scoring";

type Player = { id: string; sessionToken: string; name: string; score: number; connected: boolean };
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
const adminSessions = new Map<string, number>();
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
type SpotifyTokens = { accessToken: string; refreshToken: string; expiresAt: number };
const spotifyTokens = new Map<string, SpotifyTokens>();
const libraryAdminId = "library-admin";
const passwordHash = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
    if (error) reject(error);
    else resolve(key as Buffer);
  });
});
const adminPasswordSchema = z.string().min(12).max(128);
const adminSetupSecret = process.env.ADMIN_SETUP_SECRET || "";
const configuredAdminPassword = process.env.ADMIN_PASSWORD || "";
const adminSetupSecretMatches = (candidate: unknown) => {
  if (adminSetupSecret.length < 32 || typeof candidate !== "string") return false;
  const expected = Buffer.from(adminSetupSecret);
  const provided = Buffer.from(candidate);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
};
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
      ? "Spotify denied access to this playlist's tracks. The connected account must own the playlist or be a collaborator; a playlist being public or followed is not enough."
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
const normalizeMatchText = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const configuredJellyfin = Boolean(process.env.JELLYFIN_URL && process.env.JELLYFIN_USERNAME && process.env.JELLYFIN_PASSWORD);
const jellyfinProvider = configuredJellyfin
  ? new JellyfinMusicProvider(process.env.JELLYFIN_URL!, process.env.JELLYFIN_USERNAME!, process.env.JELLYFIN_PASSWORD!)
  : undefined;
let jellyfinReady = false;
const hasJellyfinAudio = (song: Song) => Boolean(song.jellyfinTrackId || (song.provider === "jellyfin" && song.providerTrackId));
const streamTickets = new Map<string, { url: string; expiresAt: number }>();
if (jellyfinProvider) {
  void jellyfinProvider.connect().then(() => { jellyfinReady = true; console.log("Jellyfin connected"); })
    .catch((error: unknown) => console.error("Jellyfin connection failed:", (error as Error).message));
}
const trustedProxyAddresses = new Set((process.env.TRUSTED_PROXY_ADDRESSES || "").split(",").map((value) => value.trim()).filter((value) => isIP(value)));
const normalizedAddress = (address: string) => address.startsWith("::ffff:") ? address.slice(7) : address;
const isTrustedProxy = (address: string | undefined) => Boolean(address && (trustedProxyAddresses.has(address) || trustedProxyAddresses.has(normalizedAddress(address))));
const app = express();
app.disable("x-powered-by");
app.use(helmet({
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  contentSecurityPolicy: { directives: { "style-src": ["'self'", "'unsafe-inline'"] } },
}));
app.use(express.json({ limit: "32kb" }));
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
  const nonce = randomBytes(16).toString("base64");
  res.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
  res.type("html").send(`<!doctype html><meta charset="utf-8"><title>Spotify connection</title><p>${ok ? "Connected." : "Connection failed."} This window should close automatically.</p><script nonce="${nonce}">window.opener?.postMessage(${payload},${JSON.stringify(targetOrigin)});window.close()</script>`);
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
  io = new Server(http, {
    maxHttpBufferSize: 64 * 1024,
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      const host = req.headers.host;
      const forwardedProtoHeader = req.headers["x-forwarded-proto"];
      const forwardedProto = (Array.isArray(forwardedProtoHeader) ? forwardedProtoHeader[0] : forwardedProtoHeader?.split(",")[0])?.trim();
      const protocol = isTrustedProxy(req.socket.remoteAddress) && forwardedProto
        ? forwardedProto
        : ((req.socket as typeof req.socket & { encrypted?: boolean }).encrypted ? "https" : "http");
      callback(null, !origin || (Boolean(host) && origin === `${protocol}://${host}`));
    },
  });
const joinAttemptsByAddress = new Map<string, { windowStarted: number; count: number }>();
const gameCreationAttemptsByAddress = new Map<string, { windowStarted: number; count: number }>();
const adminAuthAttemptsByAddress = new Map<string, { windowStarted: number; count: number }>();
let lastRateLimitCleanup = 0;
const clientAddress = (socket: import("socket.io").Socket) => {
  const remoteAddress = socket.conn.remoteAddress;
  if (!remoteAddress || !isTrustedProxy(remoteAddress)) return remoteAddress || socket.handshake.address;
  // Configure the trusted proxy to overwrite X-Forwarded-For with the client IP.
  const forwardedFor = socket.handshake.headers["x-forwarded-for"];
  const candidate = typeof forwardedFor === "string" ? forwardedFor.split(",")[0].trim() : "";
  return isIP(candidate) ? candidate : remoteAddress;
};
const incrementLimit = (store: Map<string, { windowStarted: number; count: number }>, address: string, limit: number, windowMs = 60_000) => {
  const now = Date.now();
  // Expire old entries and cap the number of distinct address keys to bound memory use.
  if (now - lastRateLimitCleanup >= windowMs) {
    for (const counters of [joinAttemptsByAddress, gameCreationAttemptsByAddress, adminAuthAttemptsByAddress])
      for (const [key, entry] of counters) if (now - entry.windowStarted >= windowMs) counters.delete(key);
    lastRateLimitCleanup = now;
  }
  let entry = store.get(address);
  if (!entry) {
    if (store.size >= 10_000) store.delete(store.keys().next().value!);
    entry = { windowStarted: now, count: 0 };
    store.set(address, entry);
  }
  if (now - entry.windowStarted >= windowMs) { entry.windowStarted = now; entry.count = 0; }
  return ++entry.count <= limit;
};
const code = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...randomBytes(6)].map((b) => chars[b % chars.length]).join("");
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
  playlists: g.playlists.map((p) => ({ id: p.id, name: p.name, trackCount: p.songs.length, jellyfinTrackCount: p.songs.filter(hasJellyfinAudio).length })),
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
    .regex(/^[A-Z2-9]{6}$/),
  nameSchema = z.string().trim().min(1).max(20),
  answerSchema = z.object({
    title: z.string().trim().max(100),
    artist: z.string().trim().max(100),
    year: z.number().int().min(1900).max(2100).nullable(),
  });
io.on("connection", (socket) => {
  let identity: { game: Game; playerId: string; host: boolean } | undefined;
  let adminAuthenticated = false;
  let adminSessionToken = "";
  const issueAdminSession = () => {
    const now = Date.now();
    for (const [token, expiresAt] of adminSessions) if (expiresAt <= now) adminSessions.delete(token);
    adminSessionToken = randomBytes(32).toString("hex");
    adminSessions.set(adminSessionToken, now + ADMIN_SESSION_TTL_MS);
    return adminSessionToken;
  };
  let eventWindowStarted = Date.now();
  let eventCount = 0;
  socket.use((packet, next) => {
    const now = Date.now();
    if (now - eventWindowStarted >= 10_000) { eventWindowStarted = now; eventCount = 0; }
    if (++eventCount > 120) return next(new Error("Too many requests. Please slow down."));
    next();
  });
  const requireLibraryAdmin = () => {
    if (!adminAuthenticated) throw new Error("Log in with the admin account to manage playlists.");
  };
  const allowAdminAuthAttempt = () => {
    return incrementLimit(adminAuthAttemptsByAddress, clientAddress(socket), 10);
  };
  socket.on("admin-setup-status", async (_payload: unknown, cb: (x: any) => void) => {
    try { cb({ setupRequired: !(await prisma.adminAccount.findUnique({ where: { id: "primary" } })), setupEnabled: adminSetupSecret.length >= 32 }); }
    catch { cb({ error: "Could not check admin account setup." }); }
  });
  socket.on("admin-create", async (payload: { password?: string; setupSecret?: string }, cb: (x: any) => void) => {
    if (!allowAdminAuthAttempt()) return cb({ error: "Too many admin attempts. Wait a minute and try again." });
    if (!adminSetupSecretMatches(payload?.setupSecret)) return cb({ error: "Admin setup is disabled or the one-time setup secret is incorrect." });
    const password = adminPasswordSchema.safeParse(payload?.password);
    if (!password.success) return cb({ error: "Use an admin password of at least 12 characters." });
    try {
      if (await prisma.adminAccount.findUnique({ where: { id: "primary" } }))
        return cb({ error: "Admin setup is already complete. Log in instead." });
      const salt = randomBytes(16).toString("hex");
      const hash = await passwordHash(password.data, salt);
      await prisma.adminAccount.create({ data: { id: "primary", passwordHash: hash.toString("hex"), passwordSalt: salt } });
      adminAuthenticated = true;
      cb({ ok: true, sessionToken: issueAdminSession() });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") return cb({ error: "Admin setup was just completed. Log in instead." });
      cb({ error: "Could not create the admin account." });
    }
  });
  socket.on("admin-login", async (payload: { password?: string }, cb: (x: any) => void) => {
    if (!allowAdminAuthAttempt()) return cb({ error: "Too many admin attempts. Wait a minute and try again." });
    const password = adminPasswordSchema.safeParse(payload?.password);
    if (!password.success) return cb({ error: "Invalid admin password." });
    try {
      const account = await prisma.adminAccount.findUnique({ where: { id: "primary" } });
      if (!account) return cb({ error: "Invalid admin password." });
      const passwordMatches = configuredAdminPassword.length >= 12
        ? (() => {
          const expected = Buffer.from(configuredAdminPassword);
          const provided = Buffer.from(password.data);
          return expected.length === provided.length && timingSafeEqual(expected, provided);
        })()
        : timingSafeEqual(await passwordHash(password.data, account.passwordSalt), Buffer.from(account.passwordHash, "hex"));
      if (!passwordMatches)
        return cb({ error: "Invalid admin password." });
      adminAuthenticated = true;
      cb({ ok: true, sessionToken: issueAdminSession() });
    } catch { cb({ error: "Could not verify the admin account." }); }
  });
  socket.on("admin-resume", (payload: { sessionToken?: string }, cb: (x: any) => void) => {
    const token = typeof payload?.sessionToken === "string" ? payload.sessionToken : "";
    const expiresAt = adminSessions.get(token);
    if (!token || !expiresAt || expiresAt <= Date.now()) {
      if (token) adminSessions.delete(token);
      return cb({ ok: false });
    }
    adminAuthenticated = true;
    adminSessionToken = token;
    adminSessions.set(token, Date.now() + ADMIN_SESSION_TTL_MS);
    cb({ ok: true });
  });
  socket.on("admin-logout", (_payload: unknown, cb: (x: any) => void) => {
    adminAuthenticated = false;
    if (adminSessionToken) adminSessions.delete(adminSessionToken);
    adminSessionToken = "";
    cb({ ok: true });
  });
  socket.on("create-game", async (payload: { name?: string }, cb: (x: any) => void) => {
    if (!adminAuthenticated) return cb({ error: "Log in with the admin account before hosting a game." });
    if (!incrementLimit(gameCreationAttemptsByAddress, clientAddress(socket), 10)) return cb({ error: "Too many game creation attempts. Wait a minute and try again." });
    try {
      const name = nameSchema.safeParse(payload?.name ?? "Host");
      if (!name.success) return cb({ error: "Choose a name up to 20 characters." });
      const savedPlaylists = await prisma.playlist.findMany({
        orderBy: { createdAt: "asc" },
        include: { songs: { orderBy: { position: "asc" }, include: { song: true } } },
      });
      let c = code();
      while (games.has(c)) c = code();
      const id = randomUUID(), sessionToken = randomBytes(32).toString("hex"),
        g: Game = {
          code: c,
          hostId: id,
          status: "LOBBY",
          players: new Map([[id, { id, sessionToken, name: name.data, score: 0, connected: true }]]),
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
                jellyfinTrackId: song.jellyfinTrackId || undefined,
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
      cb({ game: safeGame(g), playerId: id, playerToken: sessionToken });
      io.to(c).emit("game-state", safeGame(g));
    } catch (e) {
      cb({ error: `Could not load saved playlists: ${playlistStorageError(e)}` });
    }
  });
  socket.on("join-game", (payload: { code?: string; name?: string; playerId?: string; playerToken?: string }, cb: (x: any) => void) => {
    const c = codeSchema.safeParse(payload?.code),
      name = nameSchema.safeParse(payload?.name ?? "");
    if (!c.success || !name.success) return cb({ error: "Enter a valid six character code and a name." });
    if (!incrementLimit(joinAttemptsByAddress, clientAddress(socket), 50)) return cb({ error: "Too many room attempts. Wait a minute and try again." });
    const g = games.get(c.data);
    if (!g) return cb({ error: "Room not found. Check the code and try again." });
    if (g.status === "GAME_OVER") return cb({ error: "This game has ended." });
    if (!payload.playerToken && g.players.size >= 32) return cb({ error: "This room is full." });
    let p = payload.playerId && payload.playerToken
      ? g.players.get(payload.playerId)
      : undefined;
    if (p && p.sessionToken !== payload.playerToken) p = undefined;
    if (!p) {
      const id = randomUUID();
      p = { id, sessionToken: randomBytes(32).toString("hex"), name: name.data, score: 0, connected: true };
      g.players.set(id, p);
    }
    p.connected = true;
    identity = { game: g, playerId: p.id, host: p.id === g.hostId };
    socket.join(c.data);
    cb({ game: safeGame(g), playerId: p.id, playerToken: p.sessionToken });
    if (identity.host && g.status === "PLAYING") socket.emit("host-track", { streamUrl: g.streamUrl, simulated: !g.streamUrl, roundEndsAt: g.roundEndsAt });
    io.to(c.data).emit("game-state", safeGame(g));
  });
  const auth = (host = false) => {
    if (!identity) throw new Error("Join a room first");
    if (host && !identity.host) throw new Error("Only the host can do that");
    if (host && !adminAuthenticated) throw new Error("Log in with the admin account to control this game.");
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
    if (!(g.provider instanceof JellyfinMusicProvider) || !jellyfinReady)
      throw new Error("Jellyfin must be connected to play game tracks. Connect the Jellyfin library and try again.");
    const playlist = g.playlists.find((item) => item.id === g.gamePlaylistId);
    if (!playlist) throw new Error("Create a playlist, then select it before starting the game.");
    const playableSongs = playlist.songs.filter(hasJellyfinAudio);
    if (!playableSongs.length) throw new Error("No tracks in this playlist are matched to Jellyfin. Use Auto-Match or add Jellyfin tracks before starting.");
    let available = playableSongs.filter((song) => !g.used.includes(song.id));
    if (!available.length) {
      g.used = [];
      available = playableSongs;
    }
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
    try { requireLibraryAdmin(); } catch (e) { return cb({ error: (e as Error).message }); }
    if (!jellyfinProvider) return cb({ error: "Jellyfin is not configured on this server." });
    if (!jellyfinReady) return cb({ error: "The server could not connect to Jellyfin. Check its connection and credentials." });
    cb({ ok: true });
  });
  socket.on("library-jellyfin-playlists", async (_payload: unknown, cb: (x: any) => void) => {
    try {
      requireLibraryAdmin();
      if (!(jellyfinProvider instanceof JellyfinMusicProvider) || !jellyfinReady) throw new Error("Jellyfin is not available on this server.");
      cb({ playlists: await jellyfinProvider.listPlaylists() });
    } catch (e) { cb({ error: (e as Error).message }); }
  });
  socket.on("library-jellyfin-search", async (payload: { query?: string }, cb: (x: any) => void) => {
    try {
      requireLibraryAdmin();
      if (!(jellyfinProvider instanceof JellyfinMusicProvider) || !jellyfinReady) throw new Error("Jellyfin is not available on this server.");
      const query = z.string().trim().min(1).max(100).parse(payload?.query || "");
      cb({ songs: await jellyfinProvider.searchSongs(query) });
    } catch (e) { cb({ error: (e as Error).message }); }
  });
  socket.on("library-jellyfin-match-song", async (payload: { songId?: string; jellyfinSongId?: string }, cb: (x: any) => void) => {
    try {
      requireLibraryAdmin();
      if (!(jellyfinProvider instanceof JellyfinMusicProvider) || !jellyfinReady) throw new Error("Jellyfin is not available on this server.");
      const songId = z.string().min(1).max(200).parse(payload?.songId || "");
      const jellyfinSongId = payload?.jellyfinSongId ? z.string().min(1).max(200).parse(payload.jellyfinSongId) : "";
      const spotifySong = await prisma.song.findUnique({ where: { id: songId } });
      if (!spotifySong || spotifySong.provider !== "spotify") throw new Error("Choose a Spotify track to match.");
      const jellyfinSong = jellyfinSongId ? await jellyfinProvider.getSong(jellyfinSongId) : undefined;
      if (jellyfinSongId && !jellyfinSong?.providerTrackId) throw new Error("That Jellyfin result cannot be streamed.");
      await prisma.song.update({ where: { id: songId }, data: { jellyfinTrackId: jellyfinSong?.providerTrackId || null } });
      cb({ ok: true, jellyfinTrackId: jellyfinSong?.providerTrackId || null });
    } catch (e) { cb({ error: playlistStorageError(e) }); }
  });
  socket.on("library-jellyfin-auto-match", async (payload: { playlistId?: string }, cb: (x: any) => void) => {
    try {
      requireLibraryAdmin();
      if (!(jellyfinProvider instanceof JellyfinMusicProvider) || !jellyfinReady) throw new Error("Jellyfin is not available on this server.");
      const playlistId = z.string().min(1).max(100).parse(payload?.playlistId || "");
      const playlist = await prisma.playlist.findUnique({ where: { id: playlistId }, include: { songs: { include: { song: true } } } });
      if (!playlist) throw new Error("Playlist not found.");
      const unmatched = playlist.songs.map(({ song }) => song).filter((song) => song.provider === "spotify" && !song.jellyfinTrackId);
      if (!unmatched.length) return cb({ ok: true, matchedCount: 0, ambiguousCount: 0, unmatchedCount: 0 });

      const librarySongs = await jellyfinProvider.listAudioSongs();
      const libraryByTitleAndArtist = new Map<string, Song[]>();
      for (const item of librarySongs) {
        const key = `${normalizeMatchText(item.title)}|${normalizeMatchText(item.artist)}`;
        const candidates = libraryByTitleAndArtist.get(key) || [];
        candidates.push(item);
        libraryByTitleAndArtist.set(key, candidates);
      }
      const matches: { songId: string; jellyfinTrackId: string }[] = [];
      let ambiguousCount = 0;
      for (const song of unmatched) {
        const candidates = libraryByTitleAndArtist.get(`${normalizeMatchText(song.title)}|${normalizeMatchText(song.artist)}`) || [];
        if (candidates.length === 1 && candidates[0]?.providerTrackId) {
          matches.push({ songId: song.id, jellyfinTrackId: candidates[0].providerTrackId });
          continue;
        }
        if (candidates.length > 1) {
          const album = normalizeMatchText(song.album);
          const ranked = candidates.map((candidate) => ({
            candidate,
            score: (album && normalizeMatchText(candidate.album) === album ? 4 : 0)
              + (song.releaseYear > 0 && candidate.releaseYear === song.releaseYear ? 2 : 0),
          }));
          const bestScore = Math.max(...ranked.map(({ score }) => score));
          const best = ranked.filter(({ score }) => score === bestScore);
          if (bestScore > 0 && best.length === 1 && best[0]?.candidate.providerTrackId) {
            matches.push({ songId: song.id, jellyfinTrackId: best[0].candidate.providerTrackId });
          } else ambiguousCount++;
        }
      }
      if (matches.length) {
        await prisma.$transaction(matches.map(({ songId, jellyfinTrackId }) => prisma.song.update({
          where: { id: songId }, data: { jellyfinTrackId },
        })));
      }
      cb({ ok: true, matchedCount: matches.length, ambiguousCount, unmatchedCount: unmatched.length - matches.length - ambiguousCount });
    } catch (e) { cb({ error: playlistStorageError(e) }); }
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
      requireLibraryAdmin();
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
      requireLibraryAdmin();
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
      requireLibraryAdmin();
      cb({ connected: spotifyTokens.has(libraryAdminId), configured: Boolean(spotifyClientId) });
    }
    catch (e) { cb({ error: (e as Error).message }); }
  });
  socket.on("spotify-auth-url", (payload: { libraryId?: string }, cb: (x: any) => void) => {
    try {
      requireLibraryAdmin();
      const hostId = libraryAdminId;
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
      requireLibraryAdmin();
      spotifyTokens.delete(libraryAdminId);
      cb({ ok: true });
    }
    catch (e) { cb({ error: (e as Error).message }); }
  });
  socket.on("spotify-playlists", async (payload: { libraryId?: string }, cb: (x: any) => void) => {
    try {
      requireLibraryAdmin();
      const hostId = libraryAdminId;
      const playlists: { id: string; name: string; trackCount: number; url: string }[] = [];
      for (let offset = 0; ; offset += 50) {
        const page = await spotifyApi<{ items?: any[]; next?: string | null }>(
          hostId, `https://api.spotify.com/v1/me/playlists?limit=50&offset=${offset}`,
        );
        for (const item of page.items || []) {
          playlists.push({
            id: item.id,
            name: item.name || "Untitled playlist",
            trackCount: item.items?.total ?? item.tracks?.total ?? 0,
            url: item.external_urls?.spotify || `https://open.spotify.com/playlist/${item.id}`,
          });
        }
        if (!page.next) break;
      }
      cb({ playlists });
    } catch (e) { cb({ error: playlistStorageError(e) }); }
  });
  socket.on("spotify-import", async (payload: { url?: string; playlistId?: string; libraryId?: string }, cb: (x: any) => void) => {
    try {
      requireLibraryAdmin();
      const hostId = libraryAdminId;
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
      requireLibraryAdmin();
      const playlists = await prisma.playlist.findMany({
        orderBy: { createdAt: "asc" },
        include: { songs: { orderBy: { position: "asc" }, include: { song: true } } },
      });
      cb({ playlists: playlists.map((playlist) => ({ id: playlist.id, name: playlist.name, songs: playlist.songs.map(({ song }) => ({
        id: song.id, title: song.title, artist: song.artist, album: song.album, releaseYear: song.releaseYear,
        provider: song.provider, jellyfinTrackId: song.jellyfinTrackId,
      })) })) });
    } catch (e) { cb({ error: playlistStorageError(e) }); }
  });
  socket.on("create-playlist", async (payload: { name?: string }, cb: (x: any) => void) => {
    try {
      requireLibraryAdmin();
      const name = z.string().trim().min(1).max(32).parse(payload?.name || "");
      const saved = await prisma.playlist.create({ data: { name } });
      cb({ ok: true, playlist: { id: saved.id, name: saved.name, songs: [] } });
    } catch (e) { cb({ error: playlistStorageError(e) }); }
  });
  socket.on("rename-playlist", async (payload: { id?: string; name?: string }, cb: (x: any) => void) => {
    try {
      requireLibraryAdmin();
      const id = z.string().min(1).max(100).parse(payload?.id || "");
      const name = z.string().trim().min(1).max(32).parse(payload?.name || "");
      await prisma.playlist.update({ where: { id }, data: { name } });
      cb({ ok: true });
    } catch (e) { cb({ error: playlistStorageError(e) }); }
  });
  socket.on("delete-playlist", async (payload: { id?: string }, cb: (x: any) => void) => {
    try {
      requireLibraryAdmin();
      const id = z.string().min(1).max(100).parse(payload?.id || "");
      await prisma.playlist.delete({ where: { id } });
      cb({ ok: true });
    } catch (e) { cb({ error: playlistStorageError(e) }); }
  });
  socket.on("add-playlist-song", async (payload: { playlistId?: string; title?: string; artist?: string; album?: string; year?: number }, cb: (x: any) => void) => {
    try {
      requireLibraryAdmin();
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
      requireLibraryAdmin();
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
const host = process.env.HOST || "127.0.0.1";
http.listen(port, host, () => console.log(`Jamster server listening on ${host}:${port}`));
