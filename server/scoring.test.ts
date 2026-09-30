import { describe, expect, it } from 'vitest';
import { normalize, scoreAnswer } from './scoring';

describe('answer matching', () => {
  const song = { title: 'Dreams', artist: 'Fleetwood Mac', releaseYear: 1977 };
  it('normalizes case, punctuation, and leading The', () => {
    expect(normalize(' The Beatles! ')).toBe(normalize('beatles'));
    expect(scoreAnswer({ title: 'DREAMS!', artist: 'Fleetwood-Mac', year: 1977 }, song)).toBe(3);
  });
  it('awards a year point within the configured tolerance', () => {
    expect(scoreAnswer({ title: '', artist: '', year: 1978 }, song, 1)).toBe(1);
    expect(scoreAnswer({ title: '', artist: '', year: 1979 }, song, 1)).toBe(0);
  });
  it('does not award a year point when missing', () => {
    expect(scoreAnswer({ title: 'Dreams', artist: 'Fleetwood Mac', year: null }, song)).toBe(2);
  });
});
