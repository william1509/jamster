import type { ReactNode } from "react";

export function AdminDashboardPage(props: { name: string; setName: (value: string) => void; error: string; onCreateGame: () => void; onLogout: () => void; children: ReactNode }) {
  return <main className="landing">
    <header className="brand"><span>JAMSTER</span><span className="brand-note">ADMIN DASHBOARD</span><button className="secondary" onClick={props.onLogout}>LOG OUT</button></header>
    <div className="entry-card"><div className="eyebrow">HOST A GAME</div><label>Host name</label><input value={props.name} onChange={(event) => props.setName(event.target.value)} maxLength={20} /><button className="primary" onClick={props.onCreateGame}>CREATE GAME</button>{props.error && <div className="error">{props.error}</div>}</div>
    {props.children}
    <footer>GOOD MUSIC. QUESTIONABLE YEAR ESTIMATES.</footer>
  </main>;
}
