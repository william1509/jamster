import React from "react";
import { QRCodeSVG } from "qrcode.react";
import type { Game } from "../types";

export function GameLobbyPage({ game, host, error, joinLink, onSelectPlaylist, onSetRoundCount, onSetRoundDuration, onSetRevealDuration, onSetBonusRounds, onSetHostParticipation, onStartRound }: {
  game: Game; host: boolean; error: string; joinLink: string; onSelectPlaylist: (id: string) => void; onSetRoundCount: (count: number) => void; onSetRoundDuration: (seconds: number) => void; onSetRevealDuration: (seconds: number) => void; onSetBonusRounds: (enabled: boolean) => void; onSetHostParticipation: (enabled: boolean) => void; onStartRound: () => void;
}) {
  const selected = game.playlists.find((playlist) => playlist.id === game.selectedPlaylistId);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  return <section className="lobby">
    <div className="section-title qr-only">
      <div className="qr"><QRCodeSVG value={joinLink} size={180} bgColor="transparent" fgColor="#f2eadc" /><small>SCAN TO JOIN</small></div>
    </div>
    <div className="lobby-grid">
      <div className="player-panel"><div className="panel-head"><span>AT THE PARTY</span><span>{game.players.length} PLAYERS</span></div>
        {game.players.map((player, index) => <div className="player-row" key={player.id}><span className="avatar" style={{ "--h": `${(index * 63 + 25) % 360}deg` } as React.CSSProperties}>{player.name.slice(0, 1).toUpperCase()}</span><span>{player.name} {player.id === game.hostPlayerId && <small className="host-tag">HOST</small>}</span><i className={player.connected ? "online" : "offline"} /></div>)}
        {!game.players.length && <div className="waiting">No players have joined yet.</div>}
      </div>
      <div className="invite-panel"><div className="eyebrow">SEND THE INVITE</div><div className="invite-code">{game.code}</div><button className="secondary" onClick={() => navigator.clipboard?.writeText(joinLink)}>COPY JOIN LINK ↗</button><p>Waiting for your crew to show up.</p></div>
    </div>
    {host && <button type="button" className="secondary wide lobby-settings-toggle" aria-expanded={settingsOpen} aria-controls="lobby-settings" onClick={() => setSettingsOpen((open) => !open)}>{settingsOpen ? "CLOSE SETTINGS" : "SETTINGS"}</button>}
    {host && <div id="lobby-settings" className="lobby-settings-panel" hidden={!settingsOpen}>
    {host && <div className="jf-panel game-playlist-config"><div className="eyebrow">GAME CONFIGURATION</div><label className="playlist-select-label">GAME PLAYLIST
      <select value={game.selectedPlaylistId} disabled={game.round > 0 || !game.playlists.length} onChange={(event) => onSelectPlaylist(event.target.value)}>
        {!game.playlists.length && <option value="">No playlists available</option>}
        {game.playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name} · {playlist.jellyfinTrackCount || 0} Jellyfin tracks</option>)}
      </select>
    </label><div className="jf-count">{selected?.jellyfinTrackCount || 0} JELLYFIN TRACKS AVAILABLE TO PLAY</div></div>}
    {host && game.round === 0 && <div className="lobby-options"><label className="round-count-control">ROUNDS TO PLAY<select value={game.maxRounds} onChange={(event) => onSetRoundCount(Number(event.target.value))}>{Array.from({ length: 30 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count}</option>)}</select></label><label className="round-count-control">SONG TIMER<select value={game.roundDurationSeconds} onChange={(event) => onSetRoundDuration(Number(event.target.value))}>{[15, 30, 45, 60, 90, 120].map((seconds) => <option key={seconds} value={seconds}>{seconds} SECONDS</option>)}</select></label><label className="round-count-control">NEXT ROUND TIMER<select value={game.revealDurationSeconds} onChange={(event) => onSetRevealDuration(Number(event.target.value))}>{[3, 5, 10, 15, 20, 30].map((seconds) => <option key={seconds} value={seconds}>{seconds} SECONDS</option>)}</select></label><label className="lobby-player-toggle"><span>INCLUDE ME AS A PLAYER</span><input type="checkbox" checked={game.hostIsPlayer} onChange={(event) => onSetHostParticipation(event.target.checked)} /></label><label className="lobby-player-toggle"><span>BONUS ROUNDS</span><input type="checkbox" checked={game.bonusRoundsEnabled} onChange={(event) => onSetBonusRounds(event.target.checked)} /></label></div>}
    </div>}
    {host ? <button className="primary wide" onClick={onStartRound}>{game.round === 0 ? "START THE FIRST ROUND" : `START ROUND ${game.round + 1}`} <span>→</span></button> : <div className="waiting">✳ &nbsp; You’re in. {game.round === 0 ? "Waiting for the host to start." : `Waiting for round ${game.round + 1}.`}</div>}
    {error && <div className="error">{error}</div>}
  </section>;
}

