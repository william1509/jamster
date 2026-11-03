import type { Game, GameResult, Player } from "../types";

export function GameRevealPage({ game, sorted, myResult, host, onNextRound }: { game: Game; sorted: Player[]; myResult?: GameResult; host: boolean; onNextRound: () => void }) {
  return <section className="reveal-view"><div className="eyebrow">THE MOMENT OF TRUTH · ROUND {game.round}</div><h1>Were you <em>there?</em></h1>
    <div className="answer-card"><span className="eyebrow">THE SONG WAS</span><h2>{game.song?.title}</h2><div className="artist">{game.song?.artist}</div><div className="year">{game.song?.releaseYear || "Year unknown"}</div>{game.song?.spotifyUrl && <a className="spotify-attribution" href={game.song.spotifyUrl} target="_blank" rel="noreferrer">Metadata from Spotify - View track</a>}</div>
    {myResult && <div className="your-score"><span>YOUR ROUND SCORE</span><strong>+{myResult.points}</strong><small>{myResult.title} · {myResult.artist} · {myResult.year || "—"}</small></div>}
    <div className="leaderboard"><div className="panel-head"><span>THE LEADERBOARD</span><span>POINTS</span></div>{sorted.map((player, index) => <div className="player-row" key={player.id}><span className="rank">{String(index + 1).padStart(2, "0")}</span><span>{player.name}</span><strong>{player.score}</strong></div>)}</div>
    {host ? <button className="primary wide" onClick={onNextRound}>{game.round >= game.maxRounds ? "SEE FINAL RESULTS" : "NEXT ROUND"} <span>→</span></button> : <div className="waiting">✳ &nbsp; Waiting for the host to deal the next song.</div>}
  </section>;
}

