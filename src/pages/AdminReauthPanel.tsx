export function AdminReauthPanel(props: {
  password: string;
  setPassword: (value: string) => void;
  busy: boolean;
  error: string;
  onLogin: () => void;
}) {
  return <section className="jf-panel admin-reauth">
    <div className="eyebrow">ADMIN LOGIN REQUIRED</div><p>Log in to control this game.</p>
    <label>Admin password<input type="password" autoComplete="current-password" value={props.password} onChange={(event) => props.setPassword(event.target.value)} maxLength={128} /></label>
    <button className="secondary" type="button" disabled={props.busy} onClick={props.onLogin}>{props.busy ? "PLEASE WAIT..." : "ADMIN LOGIN"}</button>
    {props.error && <div className="error">{props.error}</div>}
  </section>;
}
