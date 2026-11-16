// SM-2 style scheduler with learning steps. Each word has two independent cards:
// 'read' (see Arabic -> understand) and 'listen' (hear audio -> understand).
export type Rating = 1 | 2 | 3 | 4; // again, hard, good, easy
export type Skill = 'read' | 'listen';

export interface Card {
  state: 'learning' | 'review' | 'relearning';
  step: number;
  due: number;
  interval_days: number;
  ease: number;
  reps: number;
  lapses: number;
  avg_ms: number | null;
  last_ms: number | null;
  last_review: number | null;
}

const MIN = 60_000;
const DAY = 86_400_000;
export const LEARNING_STEPS = [1 * MIN, 10 * MIN];
export const RELEARN_STEPS = [10 * MIN];
export const GRADUATE_DAYS = 1;
export const EASY_DAYS = 4;

export function newCard(now: number): Card {
  return { state: 'learning', step: 0, due: now, interval_days: 0, ease: 2.5, reps: 0, lapses: 0, avg_ms: null, last_ms: null, last_review: null };
}

/** Card for a word the learner already knows (placement fast-track). */
export function knownCard(now: number, days: number): Card {
  return { ...newCard(now), state: 'review', interval_days: days, due: now + days * DAY, reps: 1 };
}

const fuzz = (days: number) => (days < 3 ? days : days * (0.95 + Math.random() * 0.1));

export function schedule(card: Card, rating: Rating, now: number, responseMs?: number): Card {
  const c: Card = { ...card, reps: card.reps + 1, last_review: now };
  if (responseMs != null) {
    c.last_ms = responseMs;
    c.avg_ms = card.avg_ms == null ? responseMs : card.avg_ms * 0.7 + responseMs * 0.3;
  }
  if (c.state === 'learning' || c.state === 'relearning') {
    const steps = c.state === 'learning' ? LEARNING_STEPS : RELEARN_STEPS;
    if (rating === 1) {
      c.step = 0;
      c.due = now + steps[0];
    } else if (rating === 4) {
      c.state = 'review';
      c.interval_days = card.state === 'relearning' ? Math.max(1, card.interval_days) : EASY_DAYS;
      c.due = now + c.interval_days * DAY;
    } else if (rating === 2) {
      c.due = now + Math.max(steps[c.step] ?? steps[0], 5 * MIN) * 1.2;
    } else {
      c.step += 1;
      if (c.step >= steps.length) {
        c.state = 'review';
        c.interval_days = card.state === 'relearning' ? Math.max(1, card.interval_days) : GRADUATE_DAYS;
        c.due = now + c.interval_days * DAY;
      } else c.due = now + steps[c.step];
    }
    return c;
  }
  // review
  if (rating === 1) {
    c.lapses += 1;
    c.ease = Math.max(1.3, c.ease - 0.2);
    c.state = 'relearning';
    c.step = 0;
    c.interval_days = Math.max(1, c.interval_days * 0.5);
    c.due = now + RELEARN_STEPS[0];
    return c;
  }
  const overdueDays = Math.max(0, (now - card.due) / DAY);
  let ivl: number;
  if (rating === 2) {
    c.ease = Math.max(1.3, c.ease - 0.15);
    ivl = Math.max(card.interval_days + 1, card.interval_days * 1.2);
  } else if (rating === 3) {
    ivl = Math.max(card.interval_days + 1, (card.interval_days + overdueDays / 2) * c.ease);
  } else {
    c.ease += 0.15;
    ivl = Math.max(card.interval_days + 2, (card.interval_days + overdueDays) * c.ease * 1.3);
  }
  c.interval_days = Math.min(365, fuzz(ivl));
  c.due = now + c.interval_days * DAY;
  return c;
}

/** Score in [0,1] for a rating (feeds the skill metrics). */
export const ratingScore = (r: Rating) => ({ 1: 0, 2: 0.6, 3: 1, 4: 1 })[r];

/** "Instant" recognition: mature card answered fast. */
export const isInstant = (c: Pick<Card, 'state' | 'interval_days' | 'avg_ms'>) =>
  c.state === 'review' && c.interval_days >= 7 && c.avg_ms != null && c.avg_ms < 3000;

/** Strength 0..1 (used for read-vs-listen gap detection). */
export function strength(c: Pick<Card, 'state' | 'interval_days' | 'lapses'> | undefined | null): number {
  if (!c) return 0;
  if (c.state !== 'review') return 0.15;
  const s = Math.min(1, Math.log2(1 + c.interval_days) / Math.log2(1 + 30));
  return Math.max(0.2, s - Math.min(0.3, c.lapses * 0.05));
}
