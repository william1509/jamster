export type Player = { id: string; name: string; score: number; connected: boolean };

export type SavedPlaylist = {
  id: string;
  name: string;
  songs: {
    id: string;
    title: string;
    artist: string;
    album: string;
    releaseYear: number;
    provider?: string;
    jellyfinTrackId?: string | null;
  }[];
};

export type Game = {
  code: string;
  status: string;
  hostName: string;
  hostPlayerId?: string;
  hostIsPlayer: boolean;
  round: number;
  maxRounds: number;
  roundDurationSeconds: number;
  revealDurationSeconds: number;
  bonusRoundsEnabled: boolean;
  bonusChallenge?: "SLOWED_MUSIC" | "STUTTERED_MUSIC" | "TELEPHONE_FILTER";
  players: Player[];
  answered: number;
  answeredPlayers: string[];
  playlists: { id: string; name: string; trackCount: number; jellyfinTrackCount?: number }[];
  selectedPlaylistId: string;
  roundEndsAt?: number;
  answerEndsAt?: number;
  revealEndsAt?: number;
  roundTimeRemainingMs?: number;
  musicPlaying: boolean;
  musicSource: "MOCK" | "JELLYFIN";
  jellyfinAvailable: boolean;
  song?: { title: string; artist: string; releaseYear: number; spotifyUrl?: string };
  results?: { playerId: string; title: string; artist: string; year: number | null; points: number }[];
};

export type AnswerInput = { title: string; artist: string; year: string };
export type GameResult = { playerId: string; title: string; artist: string; year: number | null; points: number };
