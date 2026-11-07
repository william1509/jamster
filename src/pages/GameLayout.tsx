import React from "react";
import type { Game } from "../types";

export function GameLayout({ game, host, confirmStop, setConfirmStop, onStop, children }: {
  game: Game; host: boolean; confirmStop: boolean; setConfirmStop: (value: boolean) => void; onStop: () => void; children: React.ReactNode;
}) {
  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><span>JAMSTER</span></div>
      <div className="room-pill"><span>ROOM</span> {game.code}</div>
      <div className="top-round">{game.status === "LOBBY" ? "THE LINEUP" : `ROUND ${game.round} / ${game.maxRounds}`}</div>
      {host && game.status !== "GAME_OVER" && (confirmStop ? <div className="stop-confirm"><button onClick={() => setConfirmStop(false)}>CANCEL</button><button onClick={() => { setConfirmStop(false); onStop(); }}>END GAME</button></div> : <button className="stop-game" onClick={() => setConfirmStop(true)}>STOP GAME</button>)}
    </header>
    {children}
    <footer className="app-footer">GOOD MUSIC. QUESTIONABLE YEAR ESTIMATES. <span>HOSTED BY {game.hostName.toUpperCase()}</span></footer>
  </main>;
}

