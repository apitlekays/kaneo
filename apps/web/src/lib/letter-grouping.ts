/**
 * The date the register groups and sorts by. Deliberately the letter's own
 * date rather than when it was entered: the office registers historical
 * correspondence, and grouping by entry date would file decades of letters
 * under the year someone typed them in.
 */
export function letterYearDate(letter: {
  receivedAt: string | null;
  letterDate: string | null;
  createdAt: string;
}): Date {
  return new Date(letter.receivedAt ?? letter.letterDate ?? letter.createdAt);
}

export function nextSortDirection(current: "asc" | "desc"): "asc" | "desc" {
  return current === "desc" ? "asc" : "desc";
}

/** Grouping never turns off; sorting flips the groups and their contents together. */
export function groupLettersByYear<T>(
  letters: T[],
  dateOf: (letter: T) => Date,
  direction: "asc" | "desc",
): { year: number; letters: T[] }[] {
  const buckets = new Map<number, T[]>();
  for (const letter of letters) {
    const year = dateOf(letter).getUTCFullYear();
    const bucket = buckets.get(year);
    if (bucket) bucket.push(letter);
    else buckets.set(year, [letter]);
  }

  const sign = direction === "desc" ? -1 : 1;
  return [...buckets.entries()]
    .sort(([a], [b]) => (a - b) * sign)
    .map(([year, group]) => ({
      year,
      letters: [...group].sort(
        (a, b) => (dateOf(a).getTime() - dateOf(b).getTime()) * sign,
      ),
    }));
}
