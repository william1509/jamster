export function LandingPage({ onAdmin, onGuest }: { onAdmin: () => void; onGuest: () => void }) {
  return <main className="landing">
    <header className="brand"><span className="brand-icon">◒</span><span>JAMSTER</span><span className="brand-note">THE MUSIC GUESSING GAME</span></header>
    <div className="intro"><h1>Know this <em>song?</em></h1><p>Listen to a clip, name the song, and take a guess at the year.</p>
      <div className="entry-card"><button className="primary" onClick={onAdmin}>ADMIN</button><button className="secondary" onClick={onGuest}>GUEST</button></div>
    </div>
    <footer>GOOD SONGS. WILD GUESSES.</footer>
  </main>;
}
