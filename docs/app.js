'use strict';

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function jsStr(v) {
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function humanizeMs(ms) {
  ms = Number(ms);
  if (!ms || ms < 0) return '';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `≈ ${s % 1 === 0 ? s : s.toFixed(1)} s`;
  const min = s / 60;
  if (min < 60) return `≈ ${min % 1 === 0 ? min : min.toFixed(1)} Min`;
  const h = min / 60;
  return `≈ ${h % 1 === 0 ? h : h.toFixed(1)} Std`;
}

function slugEnvVar(name) {
  return 'WEBHOOK_SECRET_' + String(name || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function val(root, sel) {
  const el = root.querySelector(sel);
  return el ? el.value : '';
}

function num(root, sel) {
  const v = val(root, sel);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function checked(root, sel) {
  const el = root.querySelector(sel);
  return el ? el.checked : false;
}

/* ── Dynamic list: printers ──────────────────────────────────────────────── */

const printersContainer   = document.getElementById('printers');
const printerTemplate     = document.getElementById('printer-template');
const labelRouteTemplate  = document.getElementById('label-route-template');
const webhookTemplate     = document.getElementById('webhook-template');

function addPrinter(defaults = {}) {
  const frag = printerTemplate.content.cloneNode(true);
  const card = frag.querySelector('.printer-card');

  if (defaults.hostname)    card.querySelector('.p-hostname').value = defaults.hostname;
  if (defaults.printerName) card.querySelector('.p-printerName').value = defaults.printerName;
  if (defaults.printerHost) card.querySelector('.p-printerHost').value = defaults.printerHost;

  card.querySelector('.btn-remove').addEventListener('click', () => {
    card.remove();
    render();
  });

  const modeSelect = card.querySelector('.p-mode');
  const singleWrap = card.querySelector('.p-single-fields');
  const routingWrap = card.querySelector('.p-routing-fields');
  modeSelect.addEventListener('change', () => {
    const routing = modeSelect.value === 'routing';
    singleWrap.classList.toggle('hidden', routing);
    routingWrap.classList.toggle('hidden', !routing);
    render();
  });

  const activeTimesMode = card.querySelector('.p-activeTimesMode');
  const activeTimesCustomWrap = card.querySelector('.p-activeTimesCustomWrap');
  activeTimesMode.addEventListener('change', () => {
    activeTimesCustomWrap.classList.toggle('hidden', activeTimesMode.value !== 'custom');
    render();
  });

  const checkEnabled = card.querySelector('.p-checkEnabled');
  const checkRetryWrap = card.querySelector('.p-checkRetryWrap');
  function syncCheckRetryVisibility() {
    checkRetryWrap.classList.toggle('hidden', !checkEnabled.checked);
  }
  checkEnabled.addEventListener('change', () => { syncCheckRetryVisibility(); render(); });
  syncCheckRetryVisibility();

  card.querySelector('.btn-add-label').addEventListener('click', () => {
    addLabelRoute(card.querySelector('.labels-list'));
    render();
  });

  printersContainer.appendChild(frag);

  const appendedCard = printersContainer.lastElementChild;
  updatePrinterTitles();
  return appendedCard;
}

function addLabelRoute(listEl, defaults = {}) {
  const frag = labelRouteTemplate.content.cloneNode(true);
  const card = frag.querySelector('.label-route-card');

  if (defaults.type) card.querySelector('.lr-type').value = defaults.type;
  if (defaults.printerHost) card.querySelector('.lr-printerHost').value = defaults.printerHost;

  card.querySelector('.btn-remove').addEventListener('click', () => {
    card.remove();
    render();
  });

  listEl.appendChild(frag);
  return listEl.lastElementChild;
}

function updatePrinterTitles() {
  printersContainer.querySelectorAll('.printer-card').forEach((card, i) => {
    const hostname = val(card, '.p-hostname');
    const title = card.querySelector('.card-title');
    title.textContent = hostname ? `Drucker: ${hostname}` : `Drucker #${i + 1}`;
  });
}

/* ── Dynamic list: webhooks / status webhooks ────────────────────────────── */

function addWebhookRow(container, defaults = {}) {
  const frag = webhookTemplate.content.cloneNode(true);
  const card = frag.querySelector('.webhook-card');

  if (defaults.name) card.querySelector('.wh-name').value = defaults.name;
  if (defaults.url)  card.querySelector('.wh-url').value = defaults.url;
  if (defaults.enabled === false) card.querySelector('.wh-enabled').checked = false;

  const nameInput = card.querySelector('.wh-name');
  const secretVarInput = card.querySelector('.wh-secretVar');
  const secretMode = card.querySelector('.wh-secretMode');
  const secretVarWrap = card.querySelector('.wh-secretVarWrap');

  function syncSecretVisibility() {
    secretVarWrap.classList.toggle('hidden', secretMode.value !== 'env');
  }
  secretMode.addEventListener('change', () => { syncSecretVisibility(); render(); });
  syncSecretVisibility();

  nameInput.addEventListener('input', () => {
    if (!secretVarInput.dataset.touched) {
      secretVarInput.value = slugEnvVar(nameInput.value);
    }
  });
  secretVarInput.addEventListener('input', () => { secretVarInput.dataset.touched = '1'; });
  secretVarInput.value = slugEnvVar(defaults.name || '');

  card.querySelector('.btn-remove').addEventListener('click', () => {
    card.remove();
    render();
  });

  container.appendChild(frag);
  return container.lastElementChild;
}

/* ── Collect DOM state ────────────────────────────────────────────────────── */

function collectPrinter(card) {
  const mode = val(card, '.p-mode');
  const activeTimesMode = val(card, '.p-activeTimesMode');

  const labels = [];
  if (mode === 'routing') {
    card.querySelectorAll('.label-route-card').forEach(lr => {
      labels.push({
        type:        val(lr, '.lr-type').trim(),
        printerHost: val(lr, '.lr-printerHost').trim(),
        printerPort: num(lr, '.lr-printerPort'),
        labelType:   val(lr, '.lr-labelType').trim() || '54',
        rotate:      val(lr, '.lr-rotate'),
        enabled:     checked(lr, '.lr-enabled'),
        copies:      num(lr, '.lr-copies') || 1,
        also:        val(lr, '.lr-also').split(',').map(s => s.trim()).filter(Boolean),
      });
    });
  }

  return {
    hostname:    val(card, '.p-hostname').trim(),
    printerName: val(card, '.p-printerName').trim(),
    activeTimesMode,
    activeTimesCustom: val(card, '.p-activeTimesCustom').trim(),
    checkEnabled:         checked(card, '.p-checkEnabled'),
    checkRetryIntervalMs: num(card, '.p-checkRetryIntervalMs'),
    statusWebhook:        checked(card, '.p-statusWebhook'),
    maxRetries:        num(card, '.p-maxRetries'),
    maxAgeMs:          num(card, '.p-maxAgeMs'),
    retryDelayMs:      num(card, '.p-retryDelayMs'),
    retryOnPrintError: checked(card, '.p-retryOnPrintError'),
    mode,
    printerHost: val(card, '.p-printerHost').trim(),
    printerPort: num(card, '.p-printerPort') || 9100,
    labels,
  };
}

function collectWebhook(card) {
  const secretMode = val(card, '.wh-secretMode');
  return {
    name:    val(card, '.wh-name').trim(),
    url:     val(card, '.wh-url').trim(),
    method:  val(card, '.wh-method'),
    secretMode,
    secretVar: val(card, '.wh-secretVar').trim(),
    retry:   num(card, '.wh-retry'),
    retryMs: num(card, '.wh-retryMs'),
    enabled: checked(card, '.wh-enabled'),
  };
}

function collect() {
  const printerLabelTypeSelect = document.getElementById('printerLabelType').value;
  const printerLabelType = printerLabelTypeSelect === 'custom'
    ? document.getElementById('printerLabelTypeCustom').value.trim()
    : printerLabelTypeSelect;

  return {
    ctBaseUrl: document.getElementById('ctBaseUrl').value.trim(),
    ctUsername: document.getElementById('ctUsername').value.trim(),
    ctPassword: document.getElementById('ctPassword').value,
    logLevel: document.getElementById('logLevel').value,
    logToFile: document.getElementById('logToFile').checked,
    dryRun: document.getElementById('dryRun').checked,

    idleMs: num(document, '#idleMs'),
    activeMs: num(document, '#activeMs'),
    activeTtlMs: num(document, '#activeTtlMs'),
    pollingActiveTimes: document.getElementById('pollingActiveTimes').value,
    maxErrors: num(document, '#maxErrors'),

    logDir: document.getElementById('logDir').value.trim() || './logs',
    retentionDays: num(document, '#retentionDays'),

    printerLabelType,
    layoutFile: document.getElementById('layoutFile').value.trim() || './label-layout.json',
    printerTimeoutMs: num(document, '#printerTimeoutMs'),
    pythonBin: document.getElementById('pythonBin').value.trim() || 'python3',

    fmSeparator: document.getElementById('fmSeparator').value || '=',
    fmName: document.getElementById('fmName').value.trim() || 'name',
    fmId: document.getElementById('fmId').value.trim() || 'id',
    fmCode: document.getElementById('fmCode').value.trim() || 'code',
    fmGroup: document.getElementById('fmGroup').value.trim() || 'group',
    fmType: document.getElementById('fmType').value.trim() || 'type',
    fmExtra: document.getElementById('fmExtra').value.trim() || 'extra',
    fmParentValue: document.getElementById('fmParentValue').value.trim() || 'parent',
    fmChildValue: document.getElementById('fmChildValue').value.trim() || 'child',

    printers: Array.from(printersContainer.querySelectorAll('.printer-card')).map(collectPrinter),
    webhooks: Array.from(document.querySelectorAll('#webhooks .webhook-card')).map(collectWebhook),
    statusWebhooks: Array.from(document.querySelectorAll('#statusWebhooks .webhook-card')).map(collectWebhook),
    blockPrint: document.getElementById('blockPrint').checked,
  };
}

/* ── Generate config.js ───────────────────────────────────────────────────── */

function printerEntryJs(p) {
  const ind = '    ';
  const ind2 = '      ';
  const lines = [];
  lines.push(`${ind}{`);
  lines.push(`${ind2}hostname:    ${jsStr(p.hostname)},`);
  lines.push(`${ind2}printerName: ${jsStr(p.printerName)},`);

  if (p.activeTimesMode === 'always') {
    lines.push(`${ind2}activeTimes: null,`);
  } else if (p.activeTimesMode === 'custom') {
    lines.push(`${ind2}activeTimes: ${jsStr(p.activeTimesCustom)},`);
  }

  lines.push('');
  lines.push(`${ind2}checkEnabled:         ${p.checkEnabled},`);
  lines.push(`${ind2}checkRetryIntervalMs: ${p.checkRetryIntervalMs},`);
  lines.push(`${ind2}statusWebhook:        ${p.statusWebhook},`);
  lines.push('');
  lines.push(`${ind2}printQueue: {`);
  lines.push(`${ind2}  maxRetries:        ${p.maxRetries},`);
  lines.push(`${ind2}  maxAgeMs:          ${p.maxAgeMs},`);
  lines.push(`${ind2}  retryDelayMs:      ${p.retryDelayMs},`);
  lines.push(`${ind2}  retryOnPrintError: ${p.retryOnPrintError},`);
  lines.push(`${ind2}},`);

  if (p.mode === 'single') {
    lines.push('');
    lines.push(`${ind2}printerHost: ${jsStr(p.printerHost)},`);
    lines.push(`${ind2}printerPort: ${p.printerPort},`);
  } else {
    lines.push('');
    lines.push(`${ind2}labels: {`);
    p.labels.forEach(r => {
      const key = r.type || 'unbenannt';
      lines.push(`${ind2}  ${key}: {`);
      lines.push(`${ind2}    printerHost: ${jsStr(r.printerHost)},`);
      lines.push(`${ind2}    printerPort: ${r.printerPort},`);
      lines.push(`${ind2}    labelType:   ${jsStr(r.labelType)},`);
      lines.push(`${ind2}    rotate:      ${jsStr(r.rotate)},`);
      lines.push(`${ind2}    enabled:     ${r.enabled},`);
      lines.push(`${ind2}    copies:      ${r.copies},`);
      if (r.also.length) {
        lines.push(`${ind2}    also:        [${r.also.map(jsStr).join(', ')}],`);
      }
      lines.push(`${ind2}  },`);
    });
    lines.push(`${ind2}},`);
  }

  lines.push(`${ind}},`);
  return lines.join('\n');
}

function webhookEntryJs(w) {
  const ind = '    ';
  const ind2 = '      ';
  const secret = w.secretMode === 'env' && w.secretVar ? jsStr('env:' + w.secretVar) : 'null';
  return [
    `${ind}{`,
    `${ind2}name:    ${jsStr(w.name)},`,
    `${ind2}url:     ${jsStr(w.url)},`,
    `${ind2}method:  ${jsStr(w.method)},`,
    `${ind2}secret:  ${secret},`,
    `${ind2}retry:   ${w.retry},`,
    `${ind2}retryMs: ${w.retryMs},`,
    `${ind2}enabled: ${w.enabled},`,
    `${ind}},`,
  ].join('\n');
}

function generateConfigJs(s) {
  const printersBlock = s.printers.length
    ? s.printers.map(printerEntryJs).join('\n\n')
    : '    // mindestens ein Drucker erforderlich';

  const webhooksBlock = s.webhooks.length
    ? s.webhooks.map(webhookEntryJs).join('\n')
    : '    // keine Webhooks konfiguriert';

  const statusWebhooksBlock = s.statusWebhooks.length
    ? s.statusWebhooks.map(webhookEntryJs).join('\n')
    : '    // keine Status-Webhooks konfiguriert';

  return `'use strict';

/**
 * config.js — generiert mit dem Config-Generator (docs/index.html)
 * https://github.com/rony326/ct-checkin-printer
 *
 * Secrets (CT_USERNAME, CT_PASSWORD, CT_BASE_URL) gehören in die .env, nicht hierher.
 * Diese Datei kann sicher in Git eingecheckt werden — SOLANGE keine echten
 * Secrets direkt darin stehen. Webhook-Secrets als "env:VAR_NAME" referenzieren.
 */

module.exports = {

  // ── Polling ────────────────────────────────────────────────────────────────
  polling: {
    idleMs: ${s.idleMs},
    activeMs: ${s.activeMs},
    activeTtlMs: ${s.activeTtlMs},
    activeTimes: ${jsStr(s.pollingActiveTimes)},
    maxErrors: ${s.maxErrors},
  },

  // ── Drucker & Layout ───────────────────────────────────────────────────────
  printer: {
    labelType: ${jsStr(s.printerLabelType)},
    layoutFile: ${jsStr(s.layoutFile)},
    timeoutMs: ${s.printerTimeoutMs},
    pythonBin: ${jsStr(s.pythonBin)},
  },

  // ── Field-Mapping ──────────────────────────────────────────────────────────
  fieldMapping: {
    separator: ${jsStr(s.fmSeparator)},
    fields: {
      name:  ${jsStr(s.fmName)},
      id:    ${jsStr(s.fmId)},
      code:  ${jsStr(s.fmCode)},
      group: ${jsStr(s.fmGroup)},
      type:  ${jsStr(s.fmType)},
      extra: ${jsStr(s.fmExtra)},
    },
    parentValue: ${jsStr(s.fmParentValue)},
    childValue:  ${jsStr(s.fmChildValue)},
  },

  // ── Logging ────────────────────────────────────────────────────────────────
  logging: {
    dir: ${jsStr(s.logDir)},
    retentionDays: ${s.retentionDays},
  },

  // ── Drucker-Liste ──────────────────────────────────────────────────────────
  printers: [
${printersBlock}
  ],

  // ── Check-In Webhooks ──────────────────────────────────────────────────────
  webhooks: [
${webhooksBlock}
  ],

  // ── Webhook-Optionen ───────────────────────────────────────────────────────
  webhookOptions: {
    blockPrint: ${s.blockPrint},
  },

  // ── Status-Webhooks ────────────────────────────────────────────────────────
  statusWebhooks: [
${statusWebhooksBlock}
  ],

};
`;
}

function collectSecretVars(s) {
  const names = new Set();
  [...s.webhooks, ...s.statusWebhooks].forEach(w => {
    if (w.secretMode === 'env' && w.secretVar) names.add(w.secretVar);
  });
  return Array.from(names);
}

function generateEnv(s) {
  const secretVars = collectSecretVars(s);
  const secretsBlock = secretVars.length
    ? `\n# ── Webhook-Secrets ───────────────────────────────────────────────────────────\n` +
      secretVars.map(v => `${v}=hierEchtenWertEintragen`).join('\n') + '\n'
    : '';

  return `# ── ChurchTools Credentials ──────────────────────────────────────────────────
CT_BASE_URL=${s.ctBaseUrl}
CT_USERNAME=${s.ctUsername}
CT_PASSWORD=${s.ctPassword}

# ── Umgebung ──────────────────────────────────────────────────────────────────
LOG_LEVEL=${s.logLevel}
LOG_TO_FILE=${s.logToFile}
DRY_RUN=${s.dryRun}
${secretsBlock}`;
}

/* ── Warnings ─────────────────────────────────────────────────────────────── */

function computeWarnings(s) {
  const warnings = [];

  if (!s.ctBaseUrl) warnings.push('CT_BASE_URL ist leer.');
  if (!s.ctUsername) warnings.push('CT_USERNAME ist leer.');
  if (!s.ctPassword) warnings.push('CT_PASSWORD ist leer.');
  if (!s.printers.length) warnings.push('Es ist kein Drucker konfiguriert — mindestens einen hinzufügen.');

  const hostnames = new Set();
  s.printers.forEach((p, i) => {
    const n = i + 1;
    if (!p.hostname) warnings.push(`Drucker #${n}: hostname fehlt.`);
    if (!p.printerName) warnings.push(`Drucker #${n}: printerName fehlt.`);
    if (p.hostname) {
      if (hostnames.has(p.hostname)) warnings.push(`Drucker #${n}: hostname "${p.hostname}" ist mehrfach vergeben.`);
      hostnames.add(p.hostname);
    }
    if (p.mode === 'single' && !p.printerHost) {
      warnings.push(`Drucker #${n} (${p.hostname || '?'}): printerHost fehlt (Einzel-Modus).`);
    }
    if (p.mode === 'routing') {
      if (!p.labels.length) warnings.push(`Drucker #${n} (${p.hostname || '?'}): Routing-Modus ohne Etikettentypen.`);
      const types = new Set();
      p.labels.forEach(r => {
        if (!r.type) warnings.push(`Drucker #${n} (${p.hostname || '?'}): ein Etikettentyp hat keinen "type"-Namen.`);
        if (r.type && types.has(r.type)) warnings.push(`Drucker #${n} (${p.hostname || '?'}): Etikettentyp "${r.type}" ist mehrfach vergeben.`);
        if (r.type) types.add(r.type);
        if (!r.printerHost) warnings.push(`Drucker #${n} (${p.hostname || '?'}): Etikettentyp "${r.type || '?'}" hat kein printerHost.`);
      });
    }
  });

  s.webhooks.forEach((w, i) => {
    if (!w.url) warnings.push(`Check-In Webhook #${i + 1}: url fehlt.`);
    if (w.secretMode === 'env' && !w.secretVar) warnings.push(`Check-In Webhook #${i + 1}: Umgebungsvariable für Secret fehlt.`);
  });
  s.statusWebhooks.forEach((w, i) => {
    if (!w.url) warnings.push(`Status-Webhook #${i + 1}: url fehlt.`);
    if (w.secretMode === 'env' && !w.secretVar) warnings.push(`Status-Webhook #${i + 1}: Umgebungsvariable für Secret fehlt.`);
  });

  return warnings;
}

/* ── Render ───────────────────────────────────────────────────────────────── */

const outConfigJs = document.querySelector('#out-configjs code');
const outEnv = document.querySelector('#out-env code');
const warningsEl = document.getElementById('warnings');

function render() {
  updatePrinterTitles();

  document.querySelectorAll('[data-hint-for]').forEach(span => {
    const input = document.getElementById(span.dataset.hintFor);
    if (input) span.textContent = humanizeMs(input.value);
  });

  const customWrap = document.getElementById('printerLabelTypeCustomWrap');
  const isCustom = document.getElementById('printerLabelType').value === 'custom';
  customWrap.classList.toggle('hidden', !isCustom);

  const s = collect();
  outConfigJs.textContent = generateConfigJs(s);
  outEnv.textContent = generateEnv(s);

  const warnings = computeWarnings(s);
  warningsEl.textContent = '';
  if (warnings.length) {
    warningsEl.classList.remove('hidden');
    const strong = document.createElement('strong');
    strong.textContent = `Hinweise (${warnings.length}):`;
    const ul = document.createElement('ul');
    warnings.forEach(w => {
      const li = document.createElement('li');
      li.textContent = w;
      ul.appendChild(li);
    });
    warningsEl.appendChild(strong);
    warningsEl.appendChild(ul);
  } else {
    warningsEl.classList.add('hidden');
  }
}

/* ── Wiring ───────────────────────────────────────────────────────────────── */

document.getElementById('form').addEventListener('input', render);
document.getElementById('form').addEventListener('change', render);

document.getElementById('addPrinter').addEventListener('click', () => addPrinter());
document.getElementById('addWebhook').addEventListener('click', () => addWebhookRow(document.getElementById('webhooks')));
document.getElementById('addStatusWebhook').addEventListener('click', () => addWebhookRow(document.getElementById('statusWebhooks'), { enabled: false }));

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.output').forEach(o => o.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('out-' + tab.dataset.tab).classList.add('active');
  });
});

document.getElementById('copyBtn').addEventListener('click', async () => {
  const active = document.querySelector('.output.active code');
  try {
    await navigator.clipboard.writeText(active.textContent);
    const btn = document.getElementById('copyBtn');
    const original = btn.textContent;
    btn.textContent = 'Kopiert!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  } catch (e) {
    alert('Kopieren fehlgeschlagen — bitte manuell markieren und kopieren.');
  }
});

document.getElementById('downloadBtn').addEventListener('click', () => {
  const activeTab = document.querySelector('.tab.active').dataset.tab;
  const filename = activeTab === 'configjs' ? 'config.js' : '.env';
  const content = document.querySelector('.output.active code').textContent;
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
});

/* ── Initial state ────────────────────────────────────────────────────────── */

addPrinter({ hostname: 'B2', printerName: 'Minis', printerHost: '192.168.1.50' });
addWebhookRow(document.getElementById('webhooks'), { name: 'Prod', url: 'https://meinserver.ch/checkin/webhook' });
addWebhookRow(document.getElementById('statusWebhooks'), { name: 'Alert', url: 'https://meinserver.ch/printer/alert', enabled: false });

render();
