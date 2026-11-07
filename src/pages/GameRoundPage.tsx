import React from "react";
import type { AnswerInput, Game, Player } from "../types";

export function GameRoundPage({ game, host, error, playing, tick, streamUrl, audioRef, musicVolume, onVolumeChange, onAudioPlay, onAudioPause, onAudioEnded, onAudioError, onToggleMusic, onSubmit, answers, setAnswers, hasSubmitted, answered, participants, lockedPlayers }: {
  game: Game; host: boolean; error: string; playing: boolean; tick: number; streamUrl: string; audioRef: React.RefObject<HTMLAudioElement>; musicVolume: number; onVolumeChange: (volume: number) => void; onAudioPlay: () => void; onAudioPause: () => void; onAudioEnded: () => void; onAudioError: () => void; onToggleMusic: () => void;
  onSubmit: (event: React.FormEvent) => void; answers: AnswerInput; setAnswers: (value: AnswerInput) => void; hasSubmitted: boolean; answered: number; participants: Player[]; lockedPlayers: Player[];
}) {
  const everyoneAnswered = participants.length > 0 && participants.every((player) => lockedPlayers.some((answeredPlayer) => answeredPlayer.id === player.id));
  const bonusChallenge = game.bonusChallenge;
  const isBonusChallenge = Boolean(bonusChallenge);
  return <section className="round-view">
    <div className="round-banner"><span>ROUND {game.round}</span>{bonusChallenge && <span className="bonus-round-tag">{bonusChallenge === "SLOWED_MUSIC" ? "SLOWED SONG CHALLENGE" : bonusChallenge === "STUTTERED_MUSIC" ? "STUTTERED SONG CHALLENGE" : "TELEPHONE FILTER CHALLENGE"}</span>}</div>
    {game.status === "ANSWERING" && <div className="answer-window-banner"><span>ANSWERS CLOSE IN</span><strong>00:{String(tick).padStart(2, "0")}</strong></div>}
    {host && game.status === "PLAYING" && <><div className="host-stage">
      {!streamUrl && <p>{playing ? "Let the pretend tune play. Let the guesses roll in." : "Press play to start the music."}</p>}
      <div className={`round-timer ${tick <= 10 ? "urgent" : ""}`}><strong>{String(Math.floor(tick / 60)).padStart(2, "0")}:{String(tick % 60).padStart(2, "0")}</strong></div>
      {streamUrl && <audio className="audio-element" ref={audioRef} src={streamUrl} preload="none" onPlay={onAudioPlay} onPause={onAudioPause} onEnded={onAudioEnded} onError={onAudioError} />}
      <button className="primary play-control" disabled={tick <= 0} onClick={onToggleMusic}>{tick <= 0 ? "PLAY TIME IS UP" : playing ? "■ STOP MUSIC" : streamUrl ? "▶ PLAY THE SONG" : "▶ PLAY MOCK SONG"}</button>
      {streamUrl && <label className="music-volume-control"><span>MUSIC VOLUME</span><output>{Math.round(musicVolume * 100)}%</output><input type="range" min="0" max="1" step="0.01" value={musicVolume} aria-label="Music volume" onChange={(event) => onVolumeChange(Number(event.target.value))} /></label>}
      <div className="answer-count">{answered} OF {participants.length} PLAYERS ANSWERED</div><LockedPlayers players={lockedPlayers} />
    </div></>}
    <div key={hasSubmitted ? "submitted" : "answer"} className="answer-state-transition">
      {host && !game.hostIsPlayer
        ? <div className="submitted"><p>You’re hosting this game, so your answer won’t be scored.</p></div>
        : hasSubmitted
          ? <SubmittedState host={host} everyoneAnswered={everyoneAnswered} answered={answered} participants={participants} lockedPlayers={lockedPlayers} />
          : <AnswerForm hostGuess={host} isPlaying={playing} isBonusChallenge={isBonusChallenge} bonusChallenge={bonusChallenge} tick={tick} onSubmit={onSubmit} answers={answers} setAnswers={setAnswers} />}
    </div>
    {error && <div className="error">{error}</div>}
  </section>;
}

function AnswerForm({ hostGuess, isPlaying, isBonusChallenge, bonusChallenge, tick, onSubmit, answers, setAnswers }: { hostGuess: boolean; isPlaying: boolean; isBonusChallenge: boolean; bonusChallenge?: Game["bonusChallenge"]; tick: number; onSubmit: (event: React.FormEvent) => void; answers: AnswerInput; setAnswers: (value: AnswerInput) => void }) {
  return <form className={`answer-form ${isBonusChallenge ? "bonus-challenge" : ""}`} onSubmit={onSubmit}>{!hostGuess && isPlaying
      ? <div className={`round-timer ${tick <= 10 ? "urgent" : ""}`} aria-label="Time remaining"><strong>{String(Math.floor(tick / 60)).padStart(2, "0")}:{String(tick % 60).padStart(2, "0")}</strong></div>
      : <><div className="eyebrow">{hostGuess ? "YOUR GUESS" : "TRUST YOUR EARS"}</div><p className="speed-bonus-note">Close title, artist, and year guesses earn partial points. Exact title: up to 1,000 based on time; exact artist and year: 200 each.</p></>}{!hostGuess && <h1>{isBonusChallenge ? <em>Bonus Round</em> : <>What’s the <em>track?</em></>}</h1>}
    {isBonusChallenge && <p className="bonus-round-instructions">{bonusChallenge === "SLOWED_MUSIC" ? "The song is slowed down. Guess the title for double points." : bonusChallenge === "STUTTERED_MUSIC" ? "The song plays in short bursts. Guess the title for double points." : "The song sounds like it is coming through a phone. Guess the title for double points."}</p>}
    <label>SONG TITLE<input required={isBonusChallenge} autoComplete="off" placeholder="Name that tune" value={answers.title} onChange={(event) => setAnswers({ ...answers, title: event.target.value })} /></label>
    <label>ARTIST / BAND<input autoComplete="off" placeholder="Who made it?" value={answers.artist} onChange={(event) => setAnswers({ ...answers, artist: event.target.value })} /></label>
    <label>RELEASE YEAR<input inputMode="numeric" pattern="[0-9]{4}" placeholder="YYYY" value={answers.year} onChange={(event) => setAnswers({ ...answers, year: event.target.value })} /></label><button className="primary wide">LOCK IN MY ANSWER <span>→</span></button>
  </form>;
}

function SubmittedState({ host, everyoneAnswered, answered, participants, lockedPlayers }: { host: boolean; everyoneAnswered: boolean; answered: number; participants: Player[]; lockedPlayers: Player[] }) {
  const hostMessage = everyoneAnswered
    ? "Everyone has answered. The answer will be revealed shortly."
    : "Your answer is in. Waiting for the other players.";
  return <div className="submitted"><div className="check">✓</div><h1>Locked <em>in.</em></h1><p>{host ? hostMessage : "Your answer is in the timeline. Keep your poker face."}</p>{!host && <><div className="waiting-card">{answered} OF {participants.length} ANSWERS IN <div className="dots">● &nbsp; ● &nbsp; ●</div></div><LockedPlayers players={lockedPlayers} /></>}</div>;
}

function LockedPlayers({ players }: { players: Player[] }) {
  return <div className="locked-in-display"><span>LOCKED IN</span>{players.length ? players.map((player) => <div className="locked-in-player" key={player.id}><b>✓</b>{player.name}</div>) : <small>No answers yet</small>}</div>;
}

