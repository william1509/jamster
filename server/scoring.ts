export const normalize = (s: string) =>
  s
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .replace(/^(the)/, "");

const FUZZY_MATCH_THRESHOLD = 0.8;

function editDistance(a: string, b: string) {
  if (a.length > b.length) [a, b] = [b, a];

  let twoRowsBack: number[] | undefined;
  let previousRow = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const currentRow = new Array<number>(b.length + 1);
    currentRow[0] = i;

    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      currentRow[j] = Math.min(
        currentRow[j - 1] + 1,
        previousRow[j] + 1,
        previousRow[j - 1] + substitutionCost,
      );

      if (
        twoRowsBack && i > 1 && j > 1
        && a[i - 1] === b[j - 2]
        && a[i - 2] === b[j - 1]
      ) {
        currentRow[j] = Math.min(currentRow[j], twoRowsBack[j - 2] + 1);
      }
    }

    twoRowsBack = previousRow;
    previousRow = currentRow;
  }

  return previousRow[b.length];
}

function textSimilarity(first: string, second: string) {
  const a = normalize(first);
  const b = normalize(second);
  if (!a || !b) return 0;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length);
}

export function scoreAnswer(
  answer: { title: string; artist: string; year: number | null },
  song: { title: string; artist: string; releaseYear: number },
  remainingTimeMs = 60_000,
) {
  const titleSimilarity = textSimilarity(answer.title, song.title);
  const artistSimilarity = textSimilarity(answer.artist, song.artist);
  const titleSpeedPoints = Math.round(1000 * Math.min(60_000, Math.max(0, remainingTimeMs)) / 60_000);
  const titlePoints = titleSimilarity >= FUZZY_MATCH_THRESHOLD
    ? Math.round(titleSpeedPoints * titleSimilarity)
    : 0;
  const artistPoints = artistSimilarity >= FUZZY_MATCH_THRESHOLD
    ? Math.round(200 * artistSimilarity)
    : 0;
  const yearDifference = answer.year === null ? Number.POSITIVE_INFINITY : Math.abs(answer.year - song.releaseYear);
  const yearPoints = Math.max(0, 200 - yearDifference * 50);
  return titlePoints + artistPoints + yearPoints;
}
