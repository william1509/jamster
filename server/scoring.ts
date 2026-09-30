export const normalize = (s: string) =>
  s
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z0-9]/g, "")
    .replace(/^(the)/, "");
export function scoreAnswer(
  answer: { title: string; artist: string; year: number | null },
  song: { title: string; artist: string; releaseYear: number },
  remainingTimeMs = 60_000,
) {
  const titlePoints = normalize(answer.title) === normalize(song.title)
    ? Math.round(1000 * Math.min(60_000, Math.max(0, remainingTimeMs)) / 60_000)
    : 0;
  const artistPoints = normalize(answer.artist) === normalize(song.artist) ? 200 : 0;
  const yearPoints = answer.year === song.releaseYear ? 200 : 0;
  return titlePoints + artistPoints + yearPoints;
}
