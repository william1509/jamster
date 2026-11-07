import type { Game, Player } from "../types";
import { getBonusChallengeName } from "../bonusChallenges";

export function GameRevealPage({ game, sorted, tick }: { game: Game; sorted: Player[]; tick: number }) {
  const roundPoints = new Map<string, number>((game.results || []).map((result) => [result.playerId, result.points]));
  const countdownLabel = game.round >= game.maxRounds ? "FINAL RESULTS IN" : "NEXT ROUND IN";

  return <section className="reveal-view">
    <div className="eyebrow">THE MOMENT OF TRUTH &middot; ROUND {game.round}</div>
    {game.bonusChallenge && <div className="bonus-round-tag reveal-bonus-tag">{getBonusChallengeName(game.bonusChallenge)}</div>}
    <h1>Were you <em>there?</em></h1>
    <div className="answer-card">
      <span className="eyebrow">THE SONG WAS</span>
      <h2>{game.song?.title}</h2>
      <div className="artist">{game.song?.artist}</div>
      <div className="year">{game.song?.releaseYear || "Year unknown"}</div>
    </div>
    <div className="leaderboard">
      <div className="panel-head"><span>GLOBAL LEADERBOARD</span><span className="reveal-round-label">ROUND</span><span className="reveal-total-label">TOTAL</span></div>
      {sorted.map((player, index) => <div className="player-row" key={player.id}>
        <span className="rank">{String(index + 1).padStart(2, "0")}</span>
        <span className="reveal-player-name">{player.name}</span>
        <span className="reveal-round-points">+{roundPoints.get(player.id) || 0}</span>
        <strong className="reveal-total-points">{player.score}</strong>
      </div>)}
    </div>
    <div className="reveal-countdown">
      <span>{countdownLabel}</span>
      <strong>00:{String(tick).padStart(2, "0")}</strong>
    </div>
  </section>;
}
