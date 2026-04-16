'use strict';

/**
 * Parses and evaluates active time windows from env config.
 *
 * Format in .env:
 *   ACTIVE_TIMES=Mo-Fr:08:00-18:00,So:09:00-12:00 18:00-20:00
 *
 * Day names (case-insensitive): Mo Tu We Th Fr Sa So
 * Ranges like Mo-Fr expand to all days in between.
 * Multiple time windows per day separated by space.
 * Multiple day-entries separated by comma.
 *
 * Examples:
 *   ACTIVE_TIMES=So:09:00-12:00
 *   ACTIVE_TIMES=Mo-Fr:08:00-17:00,So:09:00-12:00 18:00-20:00
 *   ACTIVE_TIMES=Mo-So:00:00-23:59   (always active)
 */

const DAY_MAP = { mo: 1, di: 2, tu: 2, mi: 3, we: 3, do: 4, th: 4, fr: 5, sa: 6, so: 0, su: 0 };
const DAY_ORDER = [0, 1, 2, 3, 4, 5, 6]; // Sun=0 … Sat=6

function dayIndex(name) {
  const idx = DAY_MAP[name.toLowerCase()];
  if (idx === undefined) throw new Error(`Unknown day name: "${name}"`);
  return idx;
}

function expandDayRange(rangeStr) {
  if (rangeStr.includes('-')) {
    const [from, to] = rangeStr.split('-').map(d => dayIndex(d.trim()));
    // Wrap-around support: Mo-So, Fr-Mo etc.
    const days = [];
    let cur = from;
    while (true) {
      days.push(cur);
      if (cur === to) break;
      cur = (cur + 1) % 7;
      // Safety: avoid infinite loop for malformed input
      if (days.length > 7) break;
    }
    return days;
  }
  return [dayIndex(rangeStr.trim())];
}

function parseTimeWindow(str) {
  // "09:00-12:00"
  const m = str.trim().match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`Invalid time window: "${str}"`);
  return {
    startH: parseInt(m[1], 10),
    startM: parseInt(m[2], 10),
    endH:   parseInt(m[3], 10),
    endM:   parseInt(m[4], 10),
  };
}

/**
 * Parse ACTIVE_TIMES string into a lookup structure:
 * { 0: [{startH,startM,endH,endM}, ...], 1: [...], ... }
 */
function parseActiveTimes(raw) {
  if (!raw || raw.trim() === '') return null; // null = always active

  const schedule = {}; // day (0-6) → array of time windows

  // Split by comma → each entry is "DayOrRange:windows"
  const entries = raw.split(',').map(s => s.trim()).filter(Boolean);

  for (const entry of entries) {
    const colonIdx = entry.indexOf(':');
    if (colonIdx === -1) throw new Error(`Missing ":" in ACTIVE_TIMES entry: "${entry}"`);

    const dayPart  = entry.slice(0, colonIdx).trim();
    const timePart = entry.slice(colonIdx + 1).trim();

    const days    = expandDayRange(dayPart);
    const windows = timePart.split(' ').map(w => parseTimeWindow(w));

    for (const day of days) {
      if (!schedule[day]) schedule[day] = [];
      schedule[day].push(...windows);
    }
  }

  return schedule;
}

/**
 * Returns true if the given Date falls within any configured active window.
 * If schedule is null (no config), always returns true.
 */
function isActiveNow(schedule, now = new Date()) {
  if (!schedule) return true;

  const day  = now.getDay(); // 0=Sun … 6=Sat
  const windows = schedule[day];
  if (!windows || windows.length === 0) return false;

  const h = now.getHours();
  const m = now.getMinutes();
  const totalMin = h * 60 + m;

  return windows.some(w => {
    const start = w.startH * 60 + w.startM;
    const end   = w.endH   * 60 + w.endM;
    return totalMin >= start && totalMin < end;
  });
}

module.exports = { parseActiveTimes, isActiveNow };
