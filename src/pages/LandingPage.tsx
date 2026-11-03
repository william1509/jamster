export function LandingPage({ onAdmin, onGuest }: { onAdmin: () => void; onGuest: () => void }) {
  return <main className="landing">
    <header className="brand"><span className="brand-icon">◒</span><span>JAMSTER</span><span className="brand-note">THE MUSIC TIMELINE GAME</span></header>
    <div className="intro"><div className="eyebrow">A LITTLE FRIENDLY COMPETITION</div><h1>Somewhere in<br />the <em>song</em> of time.</h1><p>Hear a hit. Place it on the timeline. Prove your music memory.</p>
      <div className="entry-card"><button className="primary" onClick={onAdmin}>ADMIN</button><button className="secondary" onClick={onGuest}>GUEST</button></div>
    </div>
    <footer>GOOD MUSIC. QUESTIONABLE YEAR ESTIMATES.</footer>
  </main>;
}
