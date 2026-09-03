/**
 * Zeitfenster-Grammatik 1:1 aus v1 (`src/schedule.js`) portiert, siehe
 * Repo-Root-README Abschnitt "activeTimes Format":
 *   'Mo-Fr:08:00-17:00,So:09:00-12:00'
 *   'So:09:00-12:00 18:00-20:00'   (mehrere Fenster pro Tag, space-getrennt)
 *   ''  /  null  -> kein Zeitfenster, immer aktiv
 */

export interface TimeWindow {
  startH: number;
  startM: number;
  endH: number;
  endM: number;
}

export type Schedule = Record<number, TimeWindow[]>; // 0=So..6=Sa (JS Date.getDay())

const DAY_MAP: Record<string, number> = {
  mo: 1,
  di: 2,
  tu: 2,
  mi: 3,
  we: 3,
  do: 4,
  th: 4,
  fr: 5,
  sa: 6,
  so: 0,
  su: 0,
};

function expandDayRange(dayPart: string): number[] {
  const parts = dayPart.split('-').map((p) => p.trim().toLowerCase());
  const from = DAY_MAP[parts[0] ?? ''];
  if (from === undefined) throw new Error(`Unbekannter Wochentag: "${parts[0]}"`);
  if (parts.length === 1) return [from];

  const to = DAY_MAP[parts[1] ?? ''];
  if (to === undefined) throw new Error(`Unbekannter Wochentag: "${parts[1]}"`);

  const days = [from];
  let cur = from;
  for (let i = 0; i < 7 && cur !== to; i++) {
    cur = (cur + 1) % 7;
    days.push(cur);
  }
  return days;
}

function parseTimeWindow(raw: string): TimeWindow {
  const match = raw.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error(`Ungültiges Zeitfenster: "${raw}" (erwartet z.B. "09:00-12:00")`);

  const startH = Number(match[1]);
  const startM = Number(match[2]);
  const endH = Number(match[3]);
  const endM = Number(match[4]);
  if (startH > 23 || endH > 23 || startM > 59 || endM > 59) {
    throw new Error(`Ungültige Uhrzeit in "${raw}"`);
  }
  return { startH, startM, endH, endM };
}

export function parseActiveTimes(raw: string | null | undefined): Schedule | null {
  if (!raw || !raw.trim()) return null;

  const schedule: Schedule = {};
  for (const rawEntry of raw.split(',')) {
    const entry = rawEntry.trim();
    if (!entry) continue;

    const sepIndex = entry.indexOf(':');
    if (sepIndex === -1) throw new Error(`Ungültiger Zeitfenster-Eintrag: "${entry}" (erwartet "Tag:HH:MM-HH:MM")`);
    const dayPart = entry.slice(0, sepIndex);
    const timePart = entry.slice(sepIndex + 1);

    const days = expandDayRange(dayPart);
    const windows = timePart
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(parseTimeWindow);

    for (const day of days) {
      schedule[day] = [...(schedule[day] ?? []), ...windows];
    }
  }
  return schedule;
}

export function isActiveNow(schedule: Schedule | null, now = new Date()): boolean {
  if (!schedule) return true;
  const windows = schedule[now.getDay()];
  if (!windows || windows.length === 0) return false;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  return windows.some((w) => nowMin >= w.startH * 60 + w.startM && nowMin < w.endH * 60 + w.endM);
}

export function msUntilNextWindow(schedule: Schedule | null, now = new Date()): number | null {
  if (!schedule) return null;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowSec = now.getSeconds();

  for (let daysAhead = 0; daysAhead <= 7; daysAhead++) {
    const day = (now.getDay() + daysAhead) % 7;
    const windows = schedule[day];
    if (!windows) continue;

    for (const w of windows) {
      const startMin = w.startH * 60 + w.startM;
      if (daysAhead === 0 && startMin < nowMin) continue;
      if (daysAhead === 0 && startMin === nowMin) return 0;

      if (daysAhead === 0) {
        return (startMin - nowMin) * 60_000 - nowSec * 1000;
      }
      const msToMidnight = ((24 - now.getHours()) * 60 - now.getMinutes()) * 60_000 - nowSec * 1000;
      const fullDaysMs = (daysAhead - 1) * 24 * 60 * 60_000;
      const msFromMidnightToStart = startMin * 60_000;
      return msToMidnight + fullDaysMs + msFromMidnightToStart;
    }
  }
  return Infinity;
}

export function msUntilWindowEnd(schedule: Schedule | null, now = new Date()): number | null {
  if (!schedule) return null;
  const windows = schedule[now.getDay()];
  if (!windows) return null;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowSec = now.getSeconds();
  const active = windows.find((w) => nowMin >= w.startH * 60 + w.startM && nowMin < w.endH * 60 + w.endM);
  if (!active) return null;

  const endMin = active.endH * 60 + active.endM;
  return (endMin - nowMin) * 60_000 - nowSec * 1000;
}
