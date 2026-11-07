import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io, Socket } from "socket.io-client";
import { AdminDashboardPage } from "./pages/AdminDashboardPage";
import { AdminLoginPage } from "./pages/AdminLoginPage";
import { AdminReauthPanel } from "./pages/AdminReauthPanel";
import { GuestLoginPage } from "./pages/GuestLoginPage";
import { LandingPage } from "./pages/LandingPage";
import { GameLayout } from "./pages/GameLayout";
import { GameLobbyPage } from "./pages/GameLobbyPage";
import { GameOverPage } from "./pages/GameOverPage";
import { GameRevealPage } from "./pages/GameRevealPage";
import { GameRoundPage } from "./pages/GameRoundPage";
import { PlaylistManager } from "./pages/PlaylistManager";
import type { Game, Player, SavedPlaylist } from "./types";
import "./style.css";
import "./jellyfin.css";
import "./game-transitions.css";

const socket: Socket = io({ autoConnect: false });
function App() {
  const [libraryId] = useState(() => {
    let id = localStorage.getItem("sidea-library-id");
    if (!id) {
      id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem("sidea-library-id", id);
    }
    return id;
  });
  const [adminSetupRequired, setAdminSetupRequired] = useState<boolean | null>(null);
  const [adminSetupEnabled, setAdminSetupEnabled] = useState(false);
  const [adminAuthenticated, setAdminAuthenticated] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminSetupSecret, setAdminSetupSecret] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);
  const [screen, setScreen] = useState<"landing" | "admin-login" | "admin-dashboard" | "guest-login">(() =>
    location.pathname.match(/^\/join\/[A-Za-z0-9]{6}\/?$/) ? "guest-login" : "landing");
  const [game, setGame] = useState<Game | null>(null),
    [me, setMe] = useState(""),
    [host, setHost] = useState(false),
    [name, setName] = useState(""),
    [code, setCode] = useState(() => location.pathname.match(/^\/join\/([A-Za-z0-9]{6})\/?$/)?.[1]?.toUpperCase() || ""),
    [err, setErr] = useState(""),
    [submitted, setSubmitted] = useState(false),
    [playing, setPlaying] = useState(false),
    [tick, setTick] = useState(60),
    [musicVolume, setMusicVolume] = useState(1),
    [roundEndsAt, setRoundEndsAt] = useState(0),
    [streamUrl, setStreamUrl] = useState(""),
    [jfConnected, setJfConnected] = useState(false),
    [jfQuery, setJfQuery] = useState(""),
    [playlistName, setPlaylistName] = useState(""),
    [playlistImportStep, setPlaylistImportStep] = useState<"choose" | "spotify" | "jellyfin" | "">(""),
    [playlistImportTarget, setPlaylistImportTarget] = useState(""),
    [savedPlaylists, setSavedPlaylists] = useState<SavedPlaylist[]>([]),
    [managedPlaylistId, setManagedPlaylistId] = useState(""),
    [playlistEditName, setPlaylistEditName] = useState(""),
    [spotifyPlaylists, setSpotifyPlaylists] = useState<{ id: string; name: string; trackCount: number; url: string }[]>([]),
    [spotifyPlaylistId, setSpotifyPlaylistId] = useState(""),
    [spotifyConnected, setSpotifyConnected] = useState(false),
    [spotifyAutoload, setSpotifyAutoload] = useState(false),
    [spotifyBusy, setSpotifyBusy] = useState(false),
    [spotifyCallbackOrigin, setSpotifyCallbackOrigin] = useState(""),
    [jfResults, setJfResults] = useState<{ id: string; title: string; artist: string; album: string }[]>([]),
    [matchingSpotifySong, setMatchingSpotifySong] = useState<SavedPlaylist["songs"][number] | null>(null),
    [jfPlaylists, setJfPlaylists] = useState<{ id: string; name: string; trackCount: number }[]>([]),
    [jfPlaylistId, setJfPlaylistId] = useState(""),
    [jfNotice, setJfNotice] = useState(""),
    [jfAutoMatchNotice, setJfAutoMatchNotice] = useState(""),
    [jfBusy, setJfBusy] = useState(false),
    [confirmStop, setConfirmStop] = useState(false),
    [answers, setAnswers] = useState({ title: "", artist: "", year: "" });
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioFilterGraphRef = useRef(new WeakMap<HTMLAudioElement, {
    context: AudioContext;
    source: MediaElementAudioSourceNode;
    highPass: BiquadFilterNode;
    lowPass: BiquadFilterNode;
    gain: GainNode;
  }>());
  useEffect(() => {
    const player = audioRef.current;
    if (!player) return;
    const graph = audioFilterGraphRef.current.get(player);
    if (graph) {
      player.volume = 1;
      graph.gain.gain.setTargetAtTime(musicVolume, graph.context.currentTime, 0.015);
    } else player.volume = musicVolume;
  }, [musicVolume, streamUrl, game?.status]);
  useEffect(() => {
    const player = audioRef.current as (HTMLAudioElement & { preservesPitch?: boolean; mozPreservesPitch?: boolean; webkitPreservesPitch?: boolean }) | null;
    if (!player) return;
    const slowChallenge = game?.bonusChallenge === "SLOWED_MUSIC";
    player.playbackRate = slowChallenge ? 0.7 : 1;
    if (typeof player.preservesPitch === "boolean") player.preservesPitch = !slowChallenge;
    if (typeof player.mozPreservesPitch === "boolean") player.mozPreservesPitch = !slowChallenge;
    if (typeof player.webkitPreservesPitch === "boolean") player.webkitPreservesPitch = !slowChallenge;
  }, [game?.round, game?.bonusChallenge, streamUrl]);
  useEffect(() => {
    const player = audioRef.current;
    if (!player) return;
    const telephoneFilter = game?.bonusChallenge === "TELEPHONE_FILTER";
    let graph = audioFilterGraphRef.current.get(player);
    if (!graph && telephoneFilter) {
      try {
        const context = soundContextRef.current ?? new AudioContext();
        soundContextRef.current = context;
        const source = context.createMediaElementSource(player);
        const highPass = context.createBiquadFilter();
        highPass.type = "highpass";
        highPass.frequency.value = 300;
        const lowPass = context.createBiquadFilter();
        lowPass.type = "lowpass";
        lowPass.frequency.value = 3400;
        const gain = context.createGain();
        gain.gain.value = player.volume;
        graph = { context, source, highPass, lowPass, gain };
        audioFilterGraphRef.current.set(player, graph);
      } catch {
        setErr("This browser could not apply the telephone filter to the song.");
        return;
      }
    }
    if (!graph) return;
    try {
      graph.source.disconnect();
      graph.highPass.disconnect();
      graph.lowPass.disconnect();
      graph.gain.disconnect();
      if (telephoneFilter) {
        graph.source.connect(graph.highPass);
        graph.highPass.connect(graph.lowPass);
        graph.lowPass.connect(graph.gain);
      } else graph.source.connect(graph.gain);
      graph.gain.connect(graph.context.destination);
      player.volume = 1;
      if (graph.context.state === "suspended") void graph.context.resume().catch(() => {});
    } catch {
      setErr("This browser could not apply the telephone filter to the song.");
    }
    return () => {
      graph?.source.disconnect();
      graph?.highPass.disconnect();
      graph?.lowPass.disconnect();
      graph?.gain.disconnect();
    };
  }, [game?.round, game?.bonusChallenge, streamUrl]);
  useEffect(() => {
    const player = audioRef.current;
    if (!player || game?.bonusChallenge !== "STUTTERED_MUSIC" || !playing) {
      if (player) player.muted = false;
      return;
    }
    let audible = true;
    const interval = window.setInterval(() => {
      audible = !audible;
      player.muted = !audible;
    }, 500);
    return () => {
      window.clearInterval(interval);
      player.muted = false;
    };
  }, [game?.round, game?.bonusChallenge, playing, streamUrl]);
  const getAudioPlaybackError = (error?: unknown) => {
    const player = audioRef.current;
    const errorName = error instanceof DOMException ? error.name : "";
    if (errorName === "NotAllowedError")
      return "Your browser blocked playback. Tap Play to start the song.";
    if (errorName === "NotSupportedError" || player?.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED)
      return "Jellyfin returned an audio format this browser cannot play. Check that Jellyfin transcoding is enabled and FFmpeg is working.";
    if (player?.error?.code === MediaError.MEDIA_ERR_NETWORK)
      return "The browser could not load the Jellyfin stream. Check that the app server can reach Jellyfin and that the round has not expired.";
    if (player?.error?.code === MediaError.MEDIA_ERR_DECODE)
      return "The Jellyfin audio stream could not be decoded. Check the source track and Jellyfin transcoding logs.";
    return "The Jellyfin stream could not be played. Check the Jellyfin server and transcoding logs.";
  };
  const inspectAudioPlaybackError = async (error?: unknown) => {
    const player = audioRef.current;
    const unsupported = error instanceof DOMException && error.name === "NotSupportedError"
      || player?.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED;
    if (!unsupported || !streamUrl) {
      setErr(getAudioPlaybackError(error));
      return;
    }
    try {
      const response = await fetch(streamUrl, { method: "HEAD", cache: "no-store" });
      const contentType = response.headers.get("content-type");
      const checkSource = response.headers.get("x-stream-check");
      if (checkSource === "ticket-expired") {
        setErr("The app stream ticket expired before playback could be checked. Start a new round and try Play again.");
        return;
      }
      if (checkSource === "upstream-unreachable") {
        setErr("The app server could not reach Jellyfin to check this track. Check the Jellyfin URL and app server logs.");
        return;
      }
      if (!response.ok) {
        setErr(checkSource === "jellyfin" && response.status === 404
          ? "Jellyfin could not find this track (HTTP 404). Check that its saved Jellyfin match belongs to the configured server, then inspect Jellyfin's log for the /Audio/.../universal request."
          : `Jellyfin rejected the stream check (HTTP ${response.status}). Check the Jellyfin server logs.`);
      } else if (contentType && !contentType.toLowerCase().startsWith("audio/")) {
        setErr(`Jellyfin returned ${contentType} instead of audio data (HTTP ${response.status}). Check the Jellyfin server logs and FFmpeg setup.`);
      } else {
        setErr(`Jellyfin returned ${contentType || "an unknown content type"} (HTTP ${response.status}), but the browser could not decode it. Check the Jellyfin FFmpeg logs for this track.`);
      }
    } catch {
      setErr("The browser could not load the Jellyfin stream, and the app could not check the server response. Check the Jamster and Jellyfin server logs.");
    }
  };
  const soundContextRef = useRef<AudioContext | null>(null);
  const spotifyAutoloadRequestedRef = useRef(false);
  const lastAnswerBeepRef = useRef<{ round: number; second: number } | null>(null);
  const hostRef = useRef(false);
  const previousRoundStateRef = useRef<{ status: string; round: number } | null>(null);
  const playGameSound = (cue: "lock-in" | "round-start" | "round-end" | "countdown") => {
    try {
      const context = soundContextRef.current ?? new AudioContext();
      soundContextRef.current = context;
      void context.resume().then(() => {
        const notes = cue === "lock-in"
          ? [[880, 0, 0.11], [1175, 0.09, 0.16]]
          : cue === "round-start"
            ? [[523, 0, 0.16], [659, 0.13, 0.16], [784, 0.26, 0.25]]
            : cue === "countdown"
              ? [[tick === 1 ? 988 : 659, 0, 0.1]]
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
    const unlockAudio = () => {
      try {
        const context = soundContextRef.current ?? new AudioContext();
        soundContextRef.current = context;
        void context.resume();
      } catch {
        /* Countdown sounds are optional when Web Audio is unavailable. */
      }
    };
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!spotifyCallbackOrigin || event.origin !== spotifyCallbackOrigin || event.data?.type !== "spotify-auth-complete") return;
      setSpotifyConnected(Boolean(event.data.ok));
      setSpotifyBusy(false);
      if (!event.data.ok) setErr(event.data.message || "Spotify authorization failed.");
      else {
        setErr("");
        if (!spotifyAutoloadRequestedRef.current) {
          spotifyAutoloadRequestedRef.current = true;
          setSpotifyAutoload(true);
        }
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
    const onConnect = () => {
      const sessionToken = localStorage.getItem("sidea-admin-session");
      if (!sessionToken) return;
      socket.emit("admin-resume", { sessionToken }, (result: any) => {
        if (!result?.ok) {
          localStorage.removeItem("sidea-admin-session");
          return;
        }
        setAdminAuthenticated(true);
        setScreen((current) => current === "admin-login" ? "admin-dashboard" : current);
        socket.emit("list-playlists", {}, (playlistResult: any) => {
          if (playlistResult?.error) return;
          const items: SavedPlaylist[] = playlistResult.playlists || [];
          setSavedPlaylists(items);
          setManagedPlaylistId((current) => items.some((item) => item.id === current) ? current : items[0]?.id || "");
          setPlaylistEditName((current) => current || items[0]?.name || "");
        });
      });
    };
    socket.on("connect", onConnect);
    socket.connect();
    socket.emit("admin-setup-status", {}, (result: any) => {
      if (typeof result?.setupRequired === "boolean") setAdminSetupRequired(result.setupRequired);
      if (typeof result?.setupEnabled === "boolean") setAdminSetupEnabled(result.setupEnabled);
      else if (result?.error) setErr(result.error);
    });
    const onDisconnect = () => {
      setAdminAuthenticated(false);
      setScreen((current) => current === "admin-dashboard" ? "admin-login" : current);
    };
    socket.on("disconnect", onDisconnect);
    socket.on("game-state", (g: Game) => {
      const previous = previousRoundStateRef.current;
      if (hostRef.current && previous) {
        if (g.status === "PLAYING" && (previous.status !== "PLAYING" || previous.round !== g.round)) playGameSound("round-start");
        else if (previous.status === "PLAYING" && g.status === "ANSWERING") playGameSound("round-end");
      }
      previousRoundStateRef.current = { status: g.status, round: g.round };
      setGame(g);
      setJfConnected(g.jellyfinAvailable);
      setPlaying(g.musicPlaying);
      setRoundEndsAt(g.roundEndsAt || 0);
      if (g.roundEndsAt) setTick(Math.max(0, Math.ceil((g.roundEndsAt - Date.now()) / 1000)));
      else if (g.status === "ANSWERING" && g.answerEndsAt)
        setTick(Math.max(0, Math.ceil((g.answerEndsAt - Date.now()) / 1000)));
      else if (g.status === "REVEAL" && g.revealEndsAt)
        setTick(Math.max(0, Math.ceil((g.revealEndsAt - Date.now()) / 1000)));
      else if (g.status === "PLAYING" && g.roundTimeRemainingMs !== undefined)
        setTick(Math.max(0, Math.ceil(g.roundTimeRemainingMs / 1000)));
      setSubmitted((g.status === "PLAYING" || g.status === "ANSWERING") && Boolean(me) && g.answeredPlayers?.includes(me));
      if (g.status === "ANSWERING" || g.status === "REVEAL" || g.status === "GAME_OVER") {
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
    socket.on("answer-locked", () => {
      if (hostRef.current) playGameSound("lock-in");
    });
    socket.on("game-error", (result: { message?: string }) => {
      setErr(result.message || "The next round could not start.");
    });
    if (saved?.code && saved?.playerId && saved?.playerToken) {
      socket.emit("join-game", { code: saved.code, playerId: saved.playerId, playerToken: saved.playerToken, name: saved.name || "Player" }, (res: any) => {
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
      socket.off("game-error");
      socket.off("disconnect", onDisconnect);
      socket.off("connect", onConnect);
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
      .catch((error: unknown) => {
        if (active) {
          setPlaying(false);
          void inspectAudioPlaybackError(error);
        }
      });
    return () => {
      active = false;
    };
  }, [host, game?.status, streamUrl, tick <= 0]);
  useEffect(() => {
    const phase = game?.status;
    const deadline = phase === "PLAYING"
      ? roundEndsAt
      : phase === "ANSWERING"
        ? game?.answerEndsAt || 0
        : phase === "REVEAL"
          ? game?.revealEndsAt || 0
          : 0;
    if (!deadline) return;
    const refresh = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setTick(remaining);
      if (phase === "PLAYING" && remaining === 0 && host) {
        audioRef.current?.pause();
        setPlaying(false);
      }
    };
    refresh();
    const t = setInterval(refresh, 200);
    return () => clearInterval(t);
  }, [host, game?.status, game?.answerEndsAt, game?.revealEndsAt, roundEndsAt]);
  useEffect(() => {
    if (game?.status !== "ANSWERING" || tick <= 0) return;
    const previous = lastAnswerBeepRef.current;
    if (previous?.round === game.round && previous.second === tick) return;
    lastAnswerBeepRef.current = { round: game.round, second: tick };
    playGameSound("countdown");
  }, [game?.status, game?.round, tick]);
  const remember = (g: Game, id: string, playerToken: string, isHost: boolean, n: string) => {
    hostRef.current = isHost;
    setGame(g);
    setMe(id);
    setHost(isHost);
    setName(n);
    localStorage.setItem("sidea-session", JSON.stringify({ code: g.code, playerId: id, playerToken, host: isHost, name: n }));
    if (isHost) void emit("spotify-status", { libraryId }).then((status) => setSpotifyConnected(Boolean(status?.connected)));
  };
  const emit = (event: string, payload: any = {}) => new Promise<any>((resolve) => socket.emit(event, payload, resolve));
  const authenticateAdmin = async () => {
    setErr("");
    setAdminBusy(true);
    let setupRequired = adminSetupRequired;
    if (setupRequired === null) {
      const status = await emit("admin-setup-status");
      if (typeof status?.setupRequired !== "boolean") {
        setAdminBusy(false);
        setErr(status?.error || "Could not check admin account setup.");
        return false;
      }
      setupRequired = status.setupRequired;
      setAdminSetupRequired(setupRequired);
      setAdminSetupEnabled(Boolean(status.setupEnabled));
    }
    const result = await emit(setupRequired ? "admin-create" : "admin-login", {
      password: adminPassword,
      ...(setupRequired ? { setupSecret: adminSetupSecret } : {}),
    });
    setAdminBusy(false);
    if (result?.error) { setErr(result.error); return false; }
    setAdminAuthenticated(true);
    if (result?.sessionToken) localStorage.setItem("sidea-admin-session", result.sessionToken);
    setAdminSetupRequired(false);
    setAdminPassword("");
    setAdminSetupSecret("");
    setScreen("admin-dashboard");
    void refreshSavedPlaylists();
    void emit("spotify-status", { libraryId }).then((status) => setSpotifyConnected(Boolean(status?.connected)));
    setErr("");
    return true;
  };
  const logoutAdmin = () => {
    void emit("admin-logout");
    localStorage.removeItem("sidea-admin-session");
    setAdminAuthenticated(false);
    setAdminPassword("");
    setScreen("landing");
  };
  const create = async () => {
    setErr("");
    if (!adminAuthenticated && !(await authenticateAdmin())) return;
    const r = await emit("create-game", { name: name || "Host" });
    if (r.error) setErr(r.error);
    else { remember(r.game, r.playerId, r.playerToken, true, name || "Host"); }
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
    setPlaylistImportTarget(r.playlist?.id || "");
    setPlaylistImportStep("choose");
    setErr("");
  };
  const join = async () => {
    setErr("");
    const r = await emit("join-game", { code, name, playerId: saved?.code === code.toUpperCase() ? saved.playerId : undefined, playerToken: saved?.code === code.toUpperCase() ? saved.playerToken : undefined });
    if (r.error) setErr(r.error);
    else remember(r.game, r.playerId, r.playerToken, false, name);
  };
  const act = async (event: string) => {
    const r = await emit(event);
    if (r?.error) setErr(r.error);
    else setErr("");
  };
  const joinAnotherGame = () => {
    socket.emit("leave-game");
    localStorage.removeItem("sidea-session");
    hostRef.current = false;
    setGame(null);
    setMe("");
    setHost(false);
    setSubmitted(false);
    setPlaying(false);
    setStreamUrl("");
    setAnswers({ title: "", artist: "", year: "" });
    setCode("");
    setErr("");
    setScreen("guest-login");
  };
  const setRoundCount = async (count: number) => {
    const r = await emit("set-round-count", { count });
    if (r?.error) setErr(r.error);
    else setErr("");
  };
  const setRoundDuration = async (seconds: number) => {
    const r = await emit("set-round-duration", { seconds });
    if (r?.error) setErr(r.error);
    else setErr("");
  };
  const setRevealDuration = async (seconds: number) => {
    const r = await emit("set-reveal-duration", { seconds });
    if (r?.error) setErr(r.error);
    else setErr("");
  };
  const setBonusRounds = async (enabled: boolean) => {
    const r = await emit("set-bonus-rounds", { enabled });
    if (r?.error) setErr(r.error);
    else setErr("");
  };
  const setHostParticipation = async (enabled: boolean) => {
    const r = await emit("set-host-participation", { enabled });
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
    const r = await emit("library-jellyfin-import-playlist", { id: jfPlaylistId, playlistId: playlistImportTarget });
    setJfBusy(false);
    if (r?.error) setErr(r.error);
    else { setJfNotice(`Imported ${r.importedCount} tracks. Playlist now has ${r.totalCount} songs.`); await refreshSavedPlaylists(playlistImportTarget); setPlaylistImportStep(""); }
  };
  const searchJellyfin = async (e: React.FormEvent) => {
    e.preventDefault();
    await searchJellyfinQuery(jfQuery);
  };
  const searchJellyfinQuery = async (query: string) => {
    setJfBusy(true);
    setErr("");
    const r = await emit("library-jellyfin-search", { query });
    setJfBusy(false);
    if (r?.error) setErr(r.error);
    else setJfResults(r.songs || []);
  };
  const findSpotifySongInJellyfin = async (song: SavedPlaylist["songs"][number]) => {
    setMatchingSpotifySong(song);
    setJfResults([]);
    const query = `${song.title} ${song.artist}`.trim();
    setJfQuery(query);
    setJfBusy(true);
    setErr("");
    const connection = await emit("library-jellyfin-connect", {});
    if (connection?.error) { setJfBusy(false); setErr(connection.error); return; }
    setJfConnected(true);
    const result = await emit("library-jellyfin-search", { query });
    setJfBusy(false);
    if (result?.error) setErr(result.error);
    else setJfResults(result.songs || []);
  };
  const saveJellyfinMatch = async (jellyfinSongId?: string) => {
    if (!matchingSpotifySong) return;
    setJfBusy(true);
    setErr("");
    const result = await emit("library-jellyfin-match-song", { songId: matchingSpotifySong.id, jellyfinSongId });
    setJfBusy(false);
    if (result?.error) setErr(result.error);
    else {
      await refreshSavedPlaylists(managedPlaylistId);
      setMatchingSpotifySong(null);
      setJfResults([]);
    }
  };
  const autoMatchSpotifyTracks = async (playlistId: string) => {
    setJfBusy(true);
    setErr("");
    const connection = await emit("library-jellyfin-connect", {});
    if (connection?.error) { setJfBusy(false); setErr(connection.error); return; }
    setJfConnected(true);
    const result = await emit("library-jellyfin-auto-match", { playlistId });
    setJfBusy(false);
    if (result?.error) setErr(result.error);
    else {
      setJfAutoMatchNotice(`Matched ${result.matchedCount} tracks. ${result.ambiguousCount} need review; ${result.unmatchedCount} had no exact match.`);
      await refreshSavedPlaylists(playlistId);
    }
  };
  const resyncPlaylistTracks = async (playlistId: string) => {
    setJfBusy(true);
    setErr("");
    setJfAutoMatchNotice("");
    const connection = await emit("library-jellyfin-connect", {});
    if (connection?.error) { setJfBusy(false); setErr(connection.error); return; }
    setJfConnected(true);
    const result = await emit("library-jellyfin-resync-playlist", { playlistId });
    setJfBusy(false);
    if (result?.error) setErr(result.error);
    else {
      setJfAutoMatchNotice(`Resync complete: ${result.validCount} tracks still match, ${result.matchedCount} links repaired, ${result.staleCount} stale links found, ${result.ambiguousCount} need review, and ${result.unmatchedCount} have no match.`);
      await refreshSavedPlaylists(playlistId);
    }
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
    spotifyAutoloadRequestedRef.current = false;
    setSpotifyBusy(true);
    setErr("");
    const result = await emit("spotify-auth-url", { libraryId });
    if (result?.error) {
      setSpotifyBusy(false);
      popup.close();
      setErr(result.error);
      return;
    }
    setSpotifyCallbackOrigin(result.callbackOrigin);
    popup.location.href = result.url;
    let checks = 0;
    let checking = false;
    const poll = window.setInterval(async () => {
      if (checking) return;
      checking = true;
      checks++;
      try {
        const status = await emit("spotify-status", { libraryId });
        if (status?.connected) {
          window.clearInterval(poll);
          setSpotifyConnected(true);
          setSpotifyBusy(false);
          setErr("");
          if (!spotifyAutoloadRequestedRef.current) {
            spotifyAutoloadRequestedRef.current = true;
            setSpotifyAutoload(true);
          }
          if (!popup.closed) popup.close();
        } else if (checks >= 120 || (popup.closed && checks >= 20)) {
          window.clearInterval(poll);
          setSpotifyBusy(false);
          if (checks >= 120) setErr((current) => current || "Spotify sign-in timed out. Try connecting again.");
        }
      } finally { checking = false; }
    }, 1000);
  };
  const importSpotify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!playlistImportTarget || !spotifyPlaylistId) return;
    setSpotifyBusy(true);
    setErr("");
    const result = await emit("spotify-import", { url: `spotify:playlist:${spotifyPlaylistId}`, playlistId: playlistImportTarget, libraryId });
    setSpotifyBusy(false);
    if (result?.error) setErr(result.error);
    else {
      await refreshSavedPlaylists(playlistImportTarget);
      setPlaylistImportStep("");
    }
  };
  const loadSpotifyPlaylists = async () => {
    setSpotifyBusy(true);
    setErr("");
    const result = await emit("spotify-playlists", { libraryId });
    setSpotifyBusy(false);
    if (result?.error) setErr(result.error);
    else {
      const items = result.playlists || [];
      setSpotifyPlaylists(items);
      setSpotifyPlaylistId((selected) => (items.some((item: { id: string }) => item.id === selected) ? selected : items[0]?.id || ""));
      if (!items.length) setErr("No Spotify playlists were found for this account.");
    }
  };
  useEffect(() => {
    if (!spotifyAutoload) return;
    setSpotifyAutoload(false);
    void loadSpotifyPlaylists();
  }, [spotifyAutoload]);
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
          .catch((error: unknown) => { void inspectAudioPlaybackError(error); });
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
    if (!answers.title.trim() && !answers.artist.trim() && !answers.year.trim()) {
      setErr("Enter at least a title, artist, or year.");
      return;
    }
    const r = await emit("submit-answer", {
      title: answers.title,
      artist: answers.artist,
      year: answers.year ? Number(answers.year) : null,
    });
    if (r?.error) setErr(r.error);
    else {
      setSubmitted(true);
      setAnswers({ title: "", artist: "", year: "" });
      setErr("");
    }
  };
  const link = `${location.origin}/join/${game?.code || ""}`,
    hasSubmitted = submitted || Boolean(game?.answeredPlayers?.includes(me));
  if (!game) {
    if (screen === "landing") return <LandingPage onAdmin={() => { setErr(""); setScreen(adminAuthenticated ? "admin-dashboard" : "admin-login"); }} onGuest={() => { setErr(""); setScreen("guest-login"); }} />;
    if (screen === "admin-login") return <AdminLoginPage
      setupRequired={adminSetupRequired}
      setupEnabled={adminSetupEnabled}
      password={adminPassword}
      setPassword={setAdminPassword}
      setupSecret={adminSetupSecret}
      setSetupSecret={setAdminSetupSecret}
      busy={adminBusy}
      error={err}
      onSubmit={() => void authenticateAdmin()}
      onBack={() => { setErr(""); setScreen("landing"); }}
    />;
    if (screen === "guest-login") return <GuestLoginPage
      name={name}
      setName={setName}
      code={code}
      setCode={setCode}
      error={err}
      onJoin={() => void join()}
      onBack={() => { setErr(""); setScreen("landing"); }}
    />;
    return <AdminDashboardPage name={name} setName={setName} error={err} onCreateGame={() => void create()} onLogout={logoutAdmin}>
      {adminAuthenticated && <PlaylistManager
        error={err}
        playlists={savedPlaylists}
        playlistName={playlistName}
        setPlaylistName={setPlaylistName}
        onCreatePlaylist={createManagedPlaylist}
        managedPlaylistId={managedPlaylistId}
        onSelectPlaylist={(playlist) => { setManagedPlaylistId(playlist.id); setPlaylistEditName(playlist.name); setJfAutoMatchNotice(""); }}
        playlistEditName={playlistEditName}
        setPlaylistEditName={setPlaylistEditName}
        onManagePlaylist={managePlaylist}
        jfBusy={jfBusy}
        autoMatchNotice={jfAutoMatchNotice}
        onAutoMatch={autoMatchSpotifyTracks}
        onResyncTracks={resyncPlaylistTracks}
        matchingSong={matchingSpotifySong}
        onFindJellyfinMatch={findSpotifySongInJellyfin}
        onCloseMatch={() => setMatchingSpotifySong(null)}
        jfQuery={jfQuery}
        setJfQuery={setJfQuery}
        onSearchJellyfin={searchJellyfin}
        jfResults={jfResults}
        onSaveJellyfinMatch={saveJellyfinMatch}
        importStep={playlistImportStep}
        setImportStep={setPlaylistImportStep}
        importTargetId={playlistImportTarget}
        spotifyConnected={spotifyConnected}
        spotifyBusy={spotifyBusy}
        onConnectSpotify={connectSpotify}
        onLoadSpotifyPlaylists={loadSpotifyPlaylists}
        spotifyPlaylists={spotifyPlaylists}
        spotifyPlaylistId={spotifyPlaylistId}
        setSpotifyPlaylistId={setSpotifyPlaylistId}
        onImportSpotify={importSpotify}
        jfConnected={jfConnected}
        onConnectJellyfin={connectJellyfin}
        onLoadJellyfinPlaylists={loadJellyfinPlaylists}
        jfPlaylists={jfPlaylists}
        jfPlaylistId={jfPlaylistId}
        setJfPlaylistId={setJfPlaylistId}
        onImportJellyfin={importJellyfinPlaylist}
      />}
    </AdminDashboardPage>;
  }
  const sorted = [...game.players].sort((a, b) => b.score - a.score);
  const answered = game.answered || 0;
  const participants = game.players.filter((player) => player.connected);
  const lockedPlayers = game.players.filter((player) => game.answeredPlayers?.includes(player.id));
  return <GameLayout game={game} host={host} confirmStop={confirmStop} setConfirmStop={setConfirmStop} onStop={() => void act("stop-game")}>
    {host && !adminAuthenticated && <AdminReauthPanel password={adminPassword} setPassword={setAdminPassword} busy={adminBusy} error={err} onLogin={() => void authenticateAdmin()} />}
    <div key={`${game.status}-${game.round}`} className="game-page-transition">
      {game.status === "LOBBY" && <GameLobbyPage game={game} host={host} error={err} joinLink={link} onSelectPlaylist={selectPlaylist} onSetRoundCount={setRoundCount} onSetRoundDuration={setRoundDuration} onSetRevealDuration={setRevealDuration} onSetBonusRounds={setBonusRounds} onSetHostParticipation={setHostParticipation} onStartRound={() => void act("start-round")} />}
      {(game.status === "PLAYING" || game.status === "ANSWERING") && <GameRoundPage game={game} host={host} error={err} playing={playing} tick={tick} streamUrl={streamUrl} audioRef={audioRef} musicVolume={musicVolume} onVolumeChange={setMusicVolume}
        onAudioPlay={() => { setPlaying(true); void emit("set-music-playing", { playing: true }); }}
        onAudioPause={() => { setPlaying(false); void emit("set-music-playing", { playing: false }); }}
        onAudioEnded={() => { setPlaying(false); void emit("end-song"); }}
        onAudioError={() => { void inspectAudioPlaybackError(); }}
        onToggleMusic={toggleMusic} onSubmit={submit} answers={answers} setAnswers={setAnswers}
        hasSubmitted={hasSubmitted} answered={answered} participants={participants} lockedPlayers={lockedPlayers} />}
      {game.status === "REVEAL" && <GameRevealPage game={game} sorted={sorted} tick={tick} />}
      {game.status === "GAME_OVER" && <GameOverPage sorted={sorted} host={host} error={err} onNewGame={() => void create()} onJoinAnotherGame={joinAnotherGame} />}
    </div>
  </GameLayout>;
}
createRoot(document.getElementById("root")!).render(<App />);
