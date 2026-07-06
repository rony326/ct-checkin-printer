'use strict';

/**
 * config.js — Zentrale Konfiguration des ChurchTools Check-In Printer Service
 *
 * Secrets (CT_USERNAME, CT_PASSWORD, CT_BASE_URL) gehören in die .env, nicht hierher.
 * Diese Datei kann sicher in Git eingecheckt werden.
 */

module.exports = {

  // ── Polling ────────────────────────────────────────────────────────────────
  polling: {
    // Intervall in ms wenn kein Job in letzter Zeit (Ruhemodus)
    idleMs: 15000,

    // Intervall in ms nach einem erkannten Job (aktiver Modus)
    activeMs: 5000,

    // Wie lange im aktiven Modus bleiben nach dem letzten Job in ms (Standard: 5min)
    activeTtlMs: 300000,

    // Globale Zeitfenster für alle Drucker.
    // Leer ('') = immer aktiv. Kann pro Drucker in printers[] überschrieben werden.
    // Format: 'So:09:00-12:00 18:00-20:00' oder 'Mo-Fr:08:00-17:00,So:09:00-12:00'
    // Tagkürzel: Mo Di Mi Do Fr Sa So (auch englisch: Mo Tu We Th Fr Sa Su)
    activeTimes: 'So:09:00-13:00',

    // Anzahl aufeinanderfolgender Fehler bevor der Dienst neu gestartet wird
    maxErrors: 10,
  },

  // ── Drucker & Layout ───────────────────────────────────────────────────────
  printer: {
    // brother_ql Label-Identifier (nur für Einzel-Modus relevant)
    // Alle Typen: python3 -c "from brother_ql.labels import ALL_LABELS; [print(l.identifier, l.name) for l in ALL_LABELS]"
    labelType: '54',

    // Pfad zur Layout-Konfiguration (Blöcke, Schriftgrössen, Logo, QR-Code)
    // Gilt für Einzel- und Routing-Modus. Im Routing-Modus wird der
    // Etikettentyp (parent/child/leader) als Key in dieser Datei verwendet.
    layoutFile: './label-layout.json',

    // TCP-Verbindungs-Timeout zum Drucker in ms
    timeoutMs: 5000,

    // Pfad zum Python-Interpreter. Standard: 'python3' (systemweite Installation).
    // Für ein isoliertes virtuelles Environment (empfohlen, siehe README):
    // pythonBin: '/home/pi/checkin-printer/venv/bin/python3',
    pythonBin: 'python3',
  },

  // ── Field-Mapping ──────────────────────────────────────────────────────────
  // Definiert wie CT-Felder (linke Seite des Trennzeichens) auf interne Felder
  // gemappt werden. Das CT-Etikettentemplate muss entsprechend aufgebaut sein:
  //   name={Vorname} {Nachname}
  //   id={PersonID}
  //   code={Abholcode}
  //   group={Gruppenname}
  //   type=parent   (oder child, leader etc.)
  fieldMapping: {
    separator: '=',
    fields: {
      name:  'name',
      id:    'id',
      code:  'code',
      group: 'group',
      type:  'type',
      extra: 'extra',
    },
    parentValue: 'parent',
    childValue:  'child',
  },

  // ── Logging ────────────────────────────────────────────────────────────────
  logging: {
    // Verzeichnis für Logfiles (täglich rotiert: YYYY-MM-DD.log)
    dir: './logs',

    // Logfiles älter als X Tage werden automatisch gelöscht. 0 = unbegrenzt
    retentionDays: 14,
  },

  // ── Drucker-Liste ──────────────────────────────────────────────────────────
  // Zwei Modi:
  //   Einzel-Modus:   printerHost direkt — alle Etiketten auf einen Drucker
  //   Routing-Modus:  labels{} — jeder Etikettentyp auf eigenen Drucker/Layout
  printers: [

    // ── Beispiel 1: Einzel-Modus ───────────────────────────────────────────
    // Alle Etiketten gehen auf denselben Drucker mit demselben Layout.
    {
      // Technischer Bezeichner / Raumnummer — von CT intern verwendet
      // Erscheint in CT als "Minis (B2)"
      hostname: 'B2',
      printerName: 'Minis',

      // Physischer Drucker
      printerHost: '192.168.1.50',
      printerPort: 9100,

      // Zeitfenster nur für diesen Drucker (überschreibt polling.activeTimes)
      // Leer = globales Zeitfenster | null = immer aktiv
      activeTimes: 'So:09:00-12:00 18:00-20:00',

      // Drucker-Check vor Anmeldung
      checkEnabled:         true,    // false = Check überspringen
      checkRetryIntervalMs: 30000,   // Retry wenn offline/fehlerhaft (ms)
      statusWebhook:        true,    // Webhook bei Drucker-Fehler/Warnung

      // Retry-Queue für fehlgeschlagene Druckaufträge
      printQueue: {
        maxRetries:        5,        // Max. Versuche bevor Job verworfen
        maxAgeMs:          1800000,  // Max. Alter in ms (30min)
        retryDelayMs:      30000,    // Wie oft Status prüfen (ms)
        retryOnPrintError: true,     // Auch bei Druckfehler in Queue
      },
    },

    // ── Beispiel 2: Routing-Modus ──────────────────────────────────────────
    // Verschiedene Etiketten auf verschiedene Drucker routen.
    // labels{} aktiviert den Routing-Modus — printerHost wird nicht benötigt.
    //
    // Beim Start werden ALLE physischen Drucker dieses Standorts geprüft.
    // Gleichzeitiger Druck: verschiedene Drucker parallel, gleicher Drucker sequenziell.
    {
      hostname:    'A1',
      printerName: 'Foyer',
      activeTimes: 'So:09:00-13:00',

      checkEnabled:         true,
      checkRetryIntervalMs: 30000,
      statusWebhook:        true,
      printQueue: {
        maxRetries:        5,
        maxAgeMs:          1800000,
        retryDelayMs:      30000,
        retryOnPrintError: true,
      },

      // Routing: Key = type=-Feld im CT-Etikettentemplate
      labels: {

        // Layout kommt aus label-layout.json — Key = type-Name (parent/leader/child)
        // Eltern-Etikett → Drucker A (54mm nicht-klebend)
        parent: {
          printerHost: '192.168.1.51',
          printerPort: 9100,
          labelType:   '54',             // 54mm Endlosband
          rotate:      '0',              // '0' | '90' | '180' | '270'
          enabled:     true,             // false = Etikett deaktivieren
          copies:      1,                // Anzahl Kopien
          also:        ['leader'],  // ← neu
        },

        // Leiter-Etikett → gleicher Drucker wie parent (sequenziell)
        leader: {
          printerHost: '192.168.1.51',   // gleiche IP wie parent → sequenziell
          printerPort: 9100,
          labelType:   '54',
          rotate:      '0',
          enabled:     true,
          copies:      1,
        },

        // Kinder-Etikett → Drucker B (60x86mm selbstklebend, parallel zu A)
        child: {
          printerHost: '192.168.1.52',
          printerPort: 9100,
          labelType:   '60x86',          // DK-11234
          rotate:      '0',
          enabled:     true,
          copies:      1,
        },
      },
    },
  ],

  // ── Check-In Webhooks ──────────────────────────────────────────────────────
  // Werden nach jedem Druckauftrag gefeuert.
  // Alle aktiven Einträge werden parallel angesprochen.
  //
  // ⚠️  WICHTIG zu "secret": config.js wird üblicherweise mit ins Git-Repo
  // eingecheckt (siehe README). Ein echtes Secret NIEMALS direkt als String
  // eintragen — stattdessen per "env:VAR_NAME" auf eine Variable in der
  // (nicht versionierten) .env verweisen. Beispiel unten.
  webhooks: [
    {
      name:    'Prod',
      url:     'https://meinserver.ch/checkin/webhook',
      method:  'POST',
      secret:  'env:WEBHOOK_SECRET_PROD', // Wert steht in .env, nicht hier
      retry:   3,
      retryMs: 2000,
      enabled: true,
    },
    {
      name:    'Dev',
      url:     'https://dev.meinserver.ch/checkin/webhook',
      method:  'POST',
      secret:  null,
      retry:   1,
      retryMs: 1000,
      enabled: false,
    },
  ],

  // ── Webhook-Optionen ───────────────────────────────────────────────────────
  webhookOptions: {
    // true = Druck wartet auf erfolgreichen Webhook aller Ziele
    // false = Webhooks laufen im Hintergrund, Druck nicht blockiert (empfohlen)
    blockPrint: false,
  },

  // ── Status-Webhooks ────────────────────────────────────────────────────────
  // Separater Webhook nur für Drucker-Status-Events.
  //
  // Events:
  //   printer.error   — kritischer Fehler (Deckel offen, Band leer etc.)
  //   printer.warning — Warnung
  //   printer.ready   — Drucker wieder bereit nach Fehler
  //   printer.job_expired — Job aus Queue verworfen
  statusWebhooks: [
    {
      name:    'Alert',
      url:     'https://meinserver.ch/printer/alert',
      method:  'POST',
      secret:  null,
      retry:   3,
      retryMs: 2000,
      enabled: false,
    },
  ],

};