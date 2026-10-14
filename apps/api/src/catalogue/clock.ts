// SPDX-License-Identifier: EUPL-1.2
/** Injectable "now" of the read APIs, so date rules (upcoming, `since`) are testable. */
export const READ_API_CLOCK = Symbol('READ_API_CLOCK');
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

/**
 * Today's calendar date (`YYYY-MM-DD`) in UTC. Offering dates are local to the
 * offering time zone (spec §5); comparing with the UTC date keeps an offering
 * visible for at most a few hours after its last local day, never hides one early.
 */
export function utcToday(now: Date): string {
  return now.toISOString().slice(0, 10);
}
