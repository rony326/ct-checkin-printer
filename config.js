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

    // Anzahl aufeinanderfolgender Fehler bevor eine 60s-Pause eingelegt wird
    maxErrors: 10,
  },

  // ── Drucker & Layout ───────────────────────────────────────────────────────
  printer: {
    // brother_ql Label-Identifier
    // Alle Typen anzeigen: python3 -c "from brother_ql.labels import ALL_LABELS; [print(l.identifier, l.name) for l in ALL_LABELS]"
    labelType: '54',

    // Pfad zur Layout-Konfiguration (Blöcke, Schriftgrössen, Logo, QR-Code)
    layoutFile: './label-layout.json',

    // TCP-Verbindungs-Timeout zum Drucker in ms
    timeoutMs: 5000,
  },

  // ── Field-Mapping ──────────────────────────────────────────────────────────
  // Definiert wie CT-Felder (linke Seite des Trennzeichens) auf interne Felder
  // gemappt werden. Das CT-Etikettentemplate muss entsprechend aufgebaut sein:
  //   name={Vorname} {Nachname}
  //   id={PersonID}
  //   code={Abholcode}
  //   group={Gruppenname}
  //   type=parent   (oder child)
  fieldMapping: {
    // Trennzeichen zwischen Key und Value im CT-Etikettentext
    separator: '=',

    // Mapping: CT-Key (links vom Trennzeichen) → interner Feldname
    fields: {
      name:  'name',
      id:    'id',
      code:  'code',
      group: 'group',
      type:  'type',
      extra: 'extra',
    },

    // Wert des 'type'-Feldes für Eltern-Etiketten
    parentValue: 'parent',

    // Wert des 'type'-Feldes für Kinder-Etiketten
    childValue: 'child',
  },

  // ── Logging ────────────────────────────────────────────────────────────────
  logging: {
    // Verzeichnis für Logfiles (täglich rotiert: YYYY-MM-DD.log)
    dir: './logs',

    // Logfiles älter als X Tage werden automatisch gelöscht. 0 = unbegrenzt
    retentionDays: 14,
  },

  // ── Drucker-Liste ──────────────────────────────────────────────────────────
  // Ein Eintrag pro Labeldrucker. hostname und printerName erscheinen in
  // ChurchTools zusammen als 'Minis (B2)' — printerName (hostname).
  printers: [
    {
      // Technischer Bezeichner / Raumnummer — wird von CT intern verwendet
      hostname: 'B2',

      // Anzeigename / Raumname — erscheint in CT als 'Minis (B2)'
      printerName: 'Minis',

      // IP-Adresse des Labeldruckers im Netzwerk
      printerHost: '192.168.1.50',

      // TCP-Port des Druckers (Standard: 9100)
      printerPort: 9100,

      // Zeitfenster nur für diesen Drucker — überschreibt polling.activeTimes.
      // Leer ('') oder Feld weglassen = globales Zeitfenster verwenden.
      // null = immer aktiv (ignoriert auch globales Zeitfenster).
      activeTimes: 'So:09:00-12:00 18:00-20:00',
    },
    {
      hostname: 'A1',
      printerName: 'Foyer',
      printerHost: '192.168.1.51',
      printerPort: 9100,

      // Dieser Drucker nutzt das globale Zeitfenster (polling.activeTimes)
      // activeTimes: '',  // weglassen oder leer lassen
    },
  ],

  // ── Webhooks ───────────────────────────────────────────────────────────────
  // Ein Eintrag pro Webhook-Ziel.
  // Alle aktiven Webhooks werden nach jedem Check-In parallel gefeuert.
  webhooks: [
    {
      // Anzeigename im Log
      name: 'Prod',

      // Ziel-URL des Webhooks
      url: 'https://meinserver.ch/checkin/webhook',

      // HTTP-Methode: POST oder PUT
      method: 'POST',

      // Bearer-Token für Authorization-Header. null = kein Auth-Header
      secret: 'meinProdToken',

      // Anzahl Versuche bei Fehler
      retry: 3,

      // Wartezeit zwischen Versuchen in ms
      retryMs: 2000,

      // false = dieser Webhook ist deaktiviert ohne ihn zu löschen
      enabled: true,
    },
    {
      name: 'Dev',
      url: 'https://dev.meinserver.ch/checkin/webhook',
      method: 'POST',

      // Kein Secret für Dev-Umgebung
      secret: null,

      // Nur 1 Versuch im Dev (schnell scheitern)
      retry: 1,
      retryMs: 1000,

      // Deaktiviert — zum Aktivieren auf true setzen
      enabled: false,
    },
  ],

  // ── Webhook-Optionen ───────────────────────────────────────────────────────
  webhookOptions: {
    // true = Druck wartet auf erfolgreichen Webhook aller Ziele
    // false = Webhooks laufen im Hintergrund, Druck wird nicht blockiert (empfohlen)
    blockPrint: false,
  },

};