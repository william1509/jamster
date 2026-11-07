import { useState, type ReactNode } from "react";

export function AdminDashboardPage(props: { name: string; setName: (value: string) => void; error: string; onCreateGame: () => void; onLogout: () => void; children: ReactNode }) {
  const [playlistsOpen, setPlaylistsOpen] = useState(false);
  return <main className="landing">
    <header className="brand"><span>JAMSTER</span><span className="brand-note">ADMIN DASHBOARD</span><button className="secondary" onClick={props.onLogout}>LOG OUT</button></header>
    <div className="entry-card"><div className="eyebrow">HOST A GAME</div><label>Host name</label><input value={props.name} onChange={(event) => props.setName(event.target.value)} maxLength={20} /><button className="primary" onClick={props.onCreateGame}>CREATE GAME</button>{props.error && <div className="error">{props.error}</div>}</div>
    {props.children && <>
      <button type="button" className="secondary wide playlist-manager-toggle" aria-expanded={playlistsOpen} aria-controls="dashboard-playlists" onClick={() => setPlaylistsOpen((open) => !open)}>{playlistsOpen ? "HIDE PLAYLISTS" : "MANAGE PLAYLISTS"}</button>
      <div id="dashboard-playlists" className="dashboard-playlist-panel" hidden={!playlistsOpen}>{props.children}</div>
    </>}
    <footer>GOOD MUSIC. QUESTIONABLE YEAR ESTIMATES.</footer>
  </main>;
}
