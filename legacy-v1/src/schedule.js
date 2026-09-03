'use strict';

const DAY_MAP = { mo: 1, di: 2, tu: 2, mi: 3, we: 3, do: 4, th: 4, fr: 5, sa: 6, so: 0, su: 0 };

function dayIndex(name) {
  const idx = DAY_MAP[name.toLowerCase()];
  if (idx === undefined) throw new Error(`Unknown day name: "${name}"`);
  return idx;
}

function expandDayRange(rangeStr) {
  if (rangeStr.includes('-')) {
    const [from, to] = rangeStr.split('-').map(d => dayIndex(d.trim()));
    const days = [];
    let cur = from;
    while (true) {
      days.push(cur);
      if (cur === to) break;
      cur = (cur + 1) % 7;
      if (days.length > 7) break;
    }
    return days;
  }
  return [dayIndex(rangeStr.trim())];
}

function parseTimeWindow(str) {
  const m = str.trim().match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`Invalid time window: "${str}"`);
  const startH = parseInt(m[1], 10);
  const startM = parseInt(m[2], 10);
  const endH   = parseInt(m[3], 10);
  const endM   = parseInt(m[4], 10);
  if (startH > 23 || endH > 23 || startM > 59 || endM > 59) {
    throw new Error(`Invalid time values in window: "${str}"`);
  }
  return { startH, startM, endH, endM };
}

function parseActiveTimes(raw) {
  if (!raw || raw.trim() === '') return null;

  const schedule = {};
  const entries  = raw.split(',').map(s => s.trim()).filter(Boolean);

  for (const entry of entries) {
    const colonIdx = entry.indexOf(':');
    if (colonIdx === -1) throw new Error(`Missing ":" in ACTIVE_TIMES entry: "${entry}"`);

    const dayPart  = entry.slice(0, colonIdx).trim();
    const timePart = entry.slice(colonIdx + 1).trim();
    const days     = expandDayRange(dayPart);
    const windows  = timePart.split(' ').map(w => parseTimeWindow(w));

    for (const day of days) {
      if (!schedule[day]) schedule[day] = [];
      schedule[day].push(...windows);
    }
  }

  return schedule;
}

function isActiveNow(schedule, now = new Date()) {
  if (!schedule) return true;

  const day     = now.getDay();
  const windows = schedule[day];
  if (!windows || windows.length === 0) return false;

  const totalMin = now.getHours() * 60 + now.getMinutes();

  return windows.some(w => {
    const start = w.startH * 60 + w.startM;
    const end   = w.endH   * 60 + w.endM;
    return totalMin >= start && totalMin < end;
  });
}

/**
 * Berechnet wie viele Millisekunden bis zum nächsten Fensterstart vergehen.
 * Berücksichtigt Sekunden für präzises Aufwachen.
 * Gibt null zurück wenn kein Zeitplan konfiguriert (immer aktiv).
 * Gibt Infinity zurück wenn in den nächsten 7 Tagen kein Fenster gefunden.
 */
function msUntilNextWindow(schedule, now = new Date()) {
  if (!schedule) return null;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowSec = now.getSeconds();

  // Alle Fenster der nächsten 7 Tage durchsuchen
  for (let daysAhead = 0; daysAhead <= 7; daysAhead++) {
    const day     = (now.getDay() + daysAhead) % 7;
    const windows = schedule[day] || [];

    for (const w of windows) {
      const startMin = w.startH * 60 + w.startM;

      if (daysAhead === 0) {
        // Heute: nur Fenster die noch nicht begonnen haben
        // (oder gerade aktiv sind — dann 0 zurückgeben)
        if (startMin < nowMin) continue;          // bereits vorbei
        if (startMin === nowMin) return 0;         // gerade jetzt
        // Noch nicht gestartet
        const diffMin = startMin - nowMin;
        const diffMs  = diffMin * 60_000 - nowSec * 1000;
        return Math.max(0, diffMs);
      } else {
        // Zukünftiger Tag: Mitternacht + Startzeit
        const msToMidnight  = (24 * 60 - nowMin) * 60_000 - nowSec * 1000;
        const msDayOffset   = (daysAhead - 1) * 24 * 60 * 60_000;
        const msFromMidnight = startMin * 60_000;
        return msToMidnight + msDayOffset + msFromMidnight;
      }
    }
  }

  return Infinity; // Kein Fenster in den nächsten 7 Tagen
}

/**
 * Berechnet wie viele Millisekunden bis zum Ende des aktuellen Fensters.
 * Gibt null zurück wenn gerade kein Fenster aktiv.
 */
function msUntilWindowEnd(schedule, now = new Date()) {
  if (!schedule) return null;

  const day     = now.getDay();
  const windows = schedule[day] || [];
  const nowMin  = now.getHours() * 60 + now.getMinutes();
  const nowSec  = now.getSeconds();

  for (const w of windows) {
    const start = w.startH * 60 + w.startM;
    const end   = w.endH   * 60 + w.endM;
    if (nowMin >= start && nowMin < end) {
      const diffMin = end - nowMin;
      const diffMs  = diffMin * 60_000 - nowSec * 1000;
      return Math.max(0, diffMs);
    }
  }

  return null; // Kein aktives Fenster
}

module.exports = { parseActiveTimes, isActiveNow, msUntilNextWindow, msUntilWindowEnd };
