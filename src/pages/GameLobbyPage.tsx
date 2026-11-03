import React from "react";
import { QRCodeSVG } from "qrcode.react";
import type { Game } from "../types";

export function GameLobbyPage({ game, host, error, joinLink, onSelectPlaylist, onSetRoundCount, onStartRound }: {
  game: Game; host: boolean; error: string; joinLink: string; onSelectPlaylist: (id: string) => void; onSetRoundCount: (count: number) => void; onStartRound: () => void;
}) {
  const selected = game.playlists.find((playlist) => playlist.id === game.selectedPlaylistId);
  return <section className="lobby">
    <div className="section-title">
      <div><div className="eyebrow">ROOM {game.code}</div><h1>Bring your <em>people.</em></h1><p>Scan in or share the code. The more, the merrier.</p></div>
      <div className="qr"><QRCodeSVG value={joinLink} size={100} bgColor="transparent" fgColor="#f2eadc" /><small>SCAN TO JOIN</small></div>
    </div>
    <div className="lobby-grid">
      <div className="player-panel"><div className="panel-head"><span>AT THE PARTY</span><span>{game.players.length} PLAYERS</span></div>
        {game.players.map((player, index) => <div className="player-row" key={player.id}><span className="avatar" style={{ "--h": `${(index * 63 + 25) % 360}deg` } as React.CSSProperties}>{player.name.slice(0, 1).toUpperCase()}</span><span>{player.name} {player.id === game.players[0]?.id && <small className="host-tag">HOST</small>}</span><i className={player.connected ? "online" : "offline"} /></div>)}
      </div>
      <div className="invite-panel"><div className="eyebrow">SEND THE INVITE</div><div className="invite-code">{game.code}</div><button className="secondary" onClick={() => navigator.clipboard?.writeText(joinLink)}>COPY JOIN LINK ↗</button><p>Waiting for your crew to show up.</p></div>
    </div>
    {host && <div className="jf-panel game-playlist-config"><div className="eyebrow">GAME CONFIGURATION</div><label className="playlist-select-label">GAME PLAYLIST
      <select value={game.selectedPlaylistId} disabled={game.round > 0 || !game.playlists.length} onChange={(event) => onSelectPlaylist(event.target.value)}>
        {!game.playlists.length && <option value="">No playlists available</option>}
        {game.playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name} · {playlist.jellyfinTrackCount || 0} Jellyfin tracks</option>)}
      </select>
    </label><div className="jf-count">{selected?.jellyfinTrackCount || 0} JELLYFIN TRACKS AVAILABLE TO PLAY</div></div>}
    {host && game.round === 0 && <label className="round-count-control">ROUNDS TO PLAY<select value={game.maxRounds} onChange={(event) => onSetRoundCount(Number(event.target.value))}>{Array.from({ length: 30 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count}</option>)}</select></label>}
    {host ? <button className="primary wide" onClick={onStartRound}>{game.round === 0 ? "START THE FIRST ROUND" : `START ROUND ${game.round + 1}`} <span>→</span></button> : <div className="waiting">✳ &nbsp; You’re in. {game.round === 0 ? "Waiting for the host to start." : `Waiting for round ${game.round + 1}.`}</div>}
    {error && <div className="error">{error}</div>}
  </section>;
}

