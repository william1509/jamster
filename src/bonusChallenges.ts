import type { Game } from "./types";

type BonusChallenge = NonNullable<Game["bonusChallenge"]>;

const bonusChallengeNames: Record<BonusChallenge, string> = {
  SLOWED_MUSIC: "SLOW MOTION",
  STUTTERED_MUSIC: "TRACK GLITCH",
  TELEPHONE_FILTER: "PHONE LINE",
};

export function getBonusChallengeName(challenge?: Game["bonusChallenge"]): string {
  return challenge ? bonusChallengeNames[challenge] : "";
}
