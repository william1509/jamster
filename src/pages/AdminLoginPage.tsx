export function AdminLoginPage(props: {
  password: string;
  setPassword: (value: string) => void;
  busy: boolean;
  error: string;
  onSubmit: () => void;
  onBack: () => void;
}) {
  return <main className="landing">
    <header className="brand"><span>JAMSTER</span><span className="brand-note">ADMIN ACCESS</span></header>
    <div className="entry-card">
      <div className="eyebrow">ADMIN LOGIN</div>
      <label>Password</label>
      <input type="password" autoComplete="current-password" value={props.password} onChange={(event) => props.setPassword(event.target.value)} maxLength={128} onKeyDown={(event) => { if (event.key === "Enter") props.onSubmit(); }} />
      <button className="primary" disabled={props.busy} onClick={props.onSubmit}>{props.busy ? "PLEASE WAIT..." : "LOG IN"}</button>
      <button className="secondary" onClick={props.onBack}>BACK</button>
      {props.error && <div className="error">{props.error}</div>}
    </div>
  </main>;
}
