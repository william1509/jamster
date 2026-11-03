import type { Player } from "../types";

export function GameOverPage({ sorted, host, onNewGame }: { sorted: Player[]; host: boolean; onNewGame: () => void }) {
  return <section className="reveal-view"><div className="eyebrow">THAT'S A WRAP</div><h1>What a <em>set.</em></h1><div className="winner">✳ &nbsp; {sorted[0]?.name} takes the crown!</div>
    <div className="leaderboard">{sorted.map((player, index) => <div className="player-row" key={player.id}><span className="rank">{String(index + 1).padStart(2, "0")}</span><span>{player.name}</span><strong>{player.score}</strong></div>)}</div>{host && <button className="primary wide" onClick={onNewGame}>START A NEW GAME ↗</button>}
  </section>;
}
