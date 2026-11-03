export function GuestLoginPage(props: {
  name: string;
  setName: (value: string) => void;
  code: string;
  setCode: (value: string) => void;
  error: string;
  onJoin: () => void;
  onBack: () => void;
}) {
  return <main className="landing">
    <header className="brand"><span>JAMSTER</span><span className="brand-note">GUEST ACCESS</span></header>
    <div className="entry-card">
      <div className="eyebrow">JOIN A GAME AS A GUEST</div>
      <label>Your name</label><input value={props.name} onChange={(event) => props.setName(event.target.value)} maxLength={20} />
      <label>Room code</label><input value={props.code} onChange={(event) => props.setCode(event.target.value.toUpperCase())} maxLength={6} />
      <button className="primary" onClick={props.onJoin}>JOIN GAME</button><button className="secondary" onClick={props.onBack}>BACK</button>
      {props.error && <div className="error">{props.error}</div>}
    </div>
  </main>;
}
