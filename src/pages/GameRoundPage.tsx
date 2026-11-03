import React from "react";
import type { AnswerInput, Game, Player } from "../types";

export function GameRoundPage({ game, host, error, playing, tick, streamUrl, audioRef, onAudioPlay, onAudioPause, onToggleMusic, onReveal, onSubmit, answers, setAnswers, hasSubmitted, answered, participants, lockedPlayers }: {
  game: Game; host: boolean; error: string; playing: boolean; tick: number; streamUrl: string; audioRef: React.RefObject<HTMLAudioElement>; onAudioPlay: () => void; onAudioPause: () => void; onToggleMusic: () => void; onReveal: () => void;
  onSubmit: (event: React.FormEvent) => void; answers: AnswerInput; setAnswers: (value: AnswerInput) => void; hasSubmitted: boolean; answered: number; participants: Player[]; lockedPlayers: Player[];
}) {
  return <section className="round-view">
    <div className="round-banner"><span>ROUND {game.round}</span><span className="live"><i /> {tick > 0 ? "NOW PLAYING" : "TIME IS UP"} · {String(Math.floor(tick / 60)).padStart(2, "0")}:{String(tick % 60).padStart(2, "0")}</span></div>
    {host && <><div className="host-stage">{!playing && <div className="record">◖</div>}{!playing && <h1>Ready when you are.</h1>}
      {!streamUrl && <p>{playing ? "Let the pretend tune play. Let the guesses roll in." : "Press play to start the music."}</p>}
      <div className={`round-timer ${tick <= 10 ? "urgent" : ""}`}><strong>{String(Math.floor(tick / 60)).padStart(2, "0")}:{String(tick % 60).padStart(2, "0")}</strong></div>
      {streamUrl && <audio className="audio-element" ref={audioRef} src={streamUrl} preload="none" onPlay={onAudioPlay} onPause={onAudioPause} />}
      <button className="primary play-control" disabled={tick <= 0} onClick={onToggleMusic}>{tick <= 0 ? "PLAY TIME IS UP" : playing ? "■ STOP MUSIC" : streamUrl ? "▶ PLAY THE SONG" : "▶ PLAY MOCK SONG"}</button>
      <div className="answer-count">{answered} OF {participants.length} PLAYERS ANSWERED</div><LockedPlayers players={lockedPlayers} />
    </div><button className="reveal-btn" onClick={onReveal}>REVEAL THE ANSWER <span>→</span></button></>}
    <div key={hasSubmitted ? "submitted" : "answer"} className="answer-state-transition">
      {hasSubmitted ? <SubmittedState host={host} answered={answered} participants={participants} lockedPlayers={lockedPlayers} /> : <AnswerForm hostGuess={host} onSubmit={onSubmit} answers={answers} setAnswers={setAnswers} />}
    </div>
    {error && <div className="error">{error}</div>}
  </section>;
}

function AnswerForm({ hostGuess, onSubmit, answers, setAnswers }: { hostGuess: boolean; onSubmit: (event: React.FormEvent) => void; answers: AnswerInput; setAnswers: (value: AnswerInput) => void }) {
  return <form className="answer-form" onSubmit={onSubmit}><div className="eyebrow">{hostGuess ? "YOUR GUESS" : "TRUST YOUR EARS"}</div><p className="speed-bonus-note">Correct title: up to 1,000 points based on time remaining. Correct artist and exact year: 200 points each.</p>{!hostGuess && <h1>What’s the <em>track?</em></h1>}
    <label>SONG TITLE<input required autoComplete="off" placeholder="Name that tune" value={answers.title} onChange={(event) => setAnswers({ ...answers, title: event.target.value })} /></label>
    <label>ARTIST / BAND<input required autoComplete="off" placeholder="Who made it?" value={answers.artist} onChange={(event) => setAnswers({ ...answers, artist: event.target.value })} /></label>
    <label>RELEASE YEAR<input inputMode="numeric" pattern="[0-9]{4}" placeholder="YYYY" value={answers.year} onChange={(event) => setAnswers({ ...answers, year: event.target.value })} /></label><button className="primary wide">LOCK IN MY ANSWER <span>→</span></button>
  </form>;
}

function SubmittedState({ host, answered, participants, lockedPlayers }: { host: boolean; answered: number; participants: Player[]; lockedPlayers: Player[] }) {
  return <div className="submitted"><div className="check">✓</div><h1>Locked <em>in.</em></h1><p>{host ? "Your answer is in. Waiting for the other players." : "Your answer is in the timeline. Keep your poker face."}</p>{!host && <><div className="waiting-card">{answered} OF {participants.length} ANSWERS IN <div className="dots">● &nbsp; ● &nbsp; ●</div></div><LockedPlayers players={lockedPlayers} /></>}</div>;
}

function LockedPlayers({ players }: { players: Player[] }) {
  return <div className="locked-in-display"><span>LOCKED IN</span>{players.length ? players.map((player) => <div className="locked-in-player" key={player.id}><b>✓</b>{player.name}</div>) : <small>No answers yet</small>}</div>;
}

