export function AdminLoginPage(props: {
  setupRequired: boolean | null;
  setupEnabled: boolean;
  password: string;
  setPassword: (value: string) => void;
  setupSecret: string;
  setSetupSecret: (value: string) => void;
  busy: boolean;
  error: string;
  onSubmit: () => void;
  onBack: () => void;
}) {
  return <main className="landing">
    <header className="brand"><span>JAMSTER</span><span className="brand-note">ADMIN ACCESS</span></header>
    <div className="entry-card">
      <div className="eyebrow">{props.setupRequired === null ? "CHECKING ADMIN ACCOUNT" : props.setupRequired ? "FIRST VISIT · CREATE ADMIN ACCOUNT" : "ADMIN LOGIN"}</div>
      <label>Password</label>
      <input type="password" autoComplete={props.setupRequired ? "new-password" : "current-password"} value={props.password} onChange={(event) => props.setPassword(event.target.value)} maxLength={128} onKeyDown={(event) => { if (event.key === "Enter") props.onSubmit(); }} />
      {props.setupRequired && <><label>One-time setup secret</label><input type="password" autoComplete="off" value={props.setupSecret} onChange={(event) => props.setSetupSecret(event.target.value)} maxLength={256} onKeyDown={(event) => { if (event.key === "Enter") props.onSubmit(); }} /></>}
      {props.setupRequired && !props.setupEnabled && <div className="error">Admin setup is disabled. Configure ADMIN_SETUP_SECRET on the server first.</div>}
      <button className="primary" disabled={props.busy || props.setupRequired === null || Boolean(props.setupRequired && !props.setupEnabled)} onClick={props.onSubmit}>{props.busy ? "PLEASE WAIT..." : props.setupRequired ? "CREATE ADMIN ACCOUNT" : "LOG IN"}</button>
      <button className="secondary" onClick={props.onBack}>BACK</button>
      {props.error && <div className="error">{props.error}</div>}
    </div>
  </main>;
}
