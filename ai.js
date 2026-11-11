/* AI adapter: every model call in the app goes through this file.
 *
 * - Bring-your-own key, held in sessionStorage only and sent only to the provider.
 * - All document text is redacted for SSN/EIN/TIN patterns before it leaves the browser.
 * - Every call returns JSON at temperature 0, validated against a schema defined in code.
 *   On failure it retries once, then reports failure so the item goes to manual entry.
 * - To add a provider, add an entry to PROVIDERS with listModels() and generateJson().
 */
(function () {
  'use strict';
  var TRP = (window.TRP = window.TRP || {});

  var KEY_STORE = 'trp-api-key';
  var MODEL_STORE = 'trp-ai-model';
  var PROVIDER_STORE = 'trp-ai-provider';

  /* ---------- PII redaction and masking ---------- */

  var TIN_PATTERNS = [
    /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g,            // SSN / ITIN: 123-45-6789
    /\b\d{2}[-\s]\d{7}\b/g,                      // EIN: 12-3456789
    /\b\d{9}\b/g,                                // nine bare digits
    /[Xx*•]{3}[-\s]?[Xx*•]{2}[-\s]?\d{4}\b/g,    // truncated SSN: XXX-XX-1234
    /[Xx*•]{2}[-\s]?[Xx*•]{3,5}\d{4}\b/g         // truncated EIN: XX-XXX1234
  ];

  function redact(text) {
    var out = String(text == null ? '' : text);
    TIN_PATTERNS.forEach(function (re) {
      out = out.replace(re, '[REDACTED-TIN]');
    });
    return out;
  }

  /** Mask an SSN or EIN for display: only the last 4 digits are shown. */
  function maskTin(value, kind) {
    var digits = String(value == null ? '' : value).replace(/\D/g, '');
    var last4 = digits.slice(-4);
    if (last4.length < 4) return '••••';
    return kind === 'ein' ? '••-•••' + last4 : '•••-••-' + last4;
  }

  /* ---------- Minimal JSON schema validation ---------- */

  function validate(schema, data, path) {
    path = path || '$';
    var errors = [];
    if (!schema) return errors;
    var type = schema.type;
    var actual = Array.isArray(data) ? 'array' : data === null ? 'null' : typeof data;
    if (type === 'integer') {
      if (typeof data !== 'number' || !Number.isInteger(data)) errors.push(path + ': expected integer');
    } else if (type && type !== actual) {
      if (!(schema.nullable && data === null)) errors.push(path + ': expected ' + type + ', got ' + actual);
      return errors;
    }
    if (schema.enum && schema.enum.indexOf(data) === -1) errors.push(path + ': value not in allowed list');
    if (type === 'object' && data) {
      (schema.required || []).forEach(function (k) {
        if (!(k in data)) errors.push(path + '.' + k + ': missing');
      });
      Object.keys(schema.properties || {}).forEach(function (k) {
        if (k in data) errors = errors.concat(validate(schema.properties[k], data[k], path + '.' + k));
      });
    }
    if (type === 'array' && schema.items) {
      data.forEach(function (item, i) {
        errors = errors.concat(validate(schema.items, item, path + '[' + i + ']'));
      });
    }
    return errors;
  }

  /* ---------- Providers ---------- */

  function httpError(res, body) {
    var msg = (body && body.error && body.error.message) || res.statusText || 'Request failed';
    var err = new Error(msg);
    err.status = res.status;
    return err;
  }

  var PROVIDERS = {
    gemini: {
      id: 'gemini',
      label: 'Google Gemini',
      keyHelpUrl: 'https://aistudio.google.com/app/apikey',
      base: 'https://generativelanguage.googleapis.com/v1beta',

      /** Lists the text models this key can use. Doubles as the connection test. */
      listModels: async function (key) {
        var res = await fetch(this.base + '/models?pageSize=200', {
          headers: { 'x-goog-api-key': key }
        });
        var body = await res.json().catch(function () { return null; });
        if (!res.ok) throw httpError(res, body);
        return ((body && body.models) || [])
          .filter(function (m) {
            return (m.supportedGenerationMethods || []).indexOf('generateContent') !== -1 &&
              /gemini/i.test(m.name);
          })
          .map(function (m) { return { id: m.name, label: m.displayName || m.name }; });
      },

      /** Picks a general-purpose "flash" model from the list rather than hard-coding a name. */
      pickDefaultModel: function (models) {
        var skip = /(preview|exp|lite|tts|image|live|audio|embedding|vision|thinking|learn)/i;
        var version = function (m) {
          var v = /gemini-(\d+(?:\.\d+)?)/i.exec(m.id);
          return v ? parseFloat(v[1]) : 0;
        };
        var pool = models.filter(function (m) { return /flash/i.test(m.id) && !skip.test(m.id); });
        if (!pool.length) pool = models.filter(function (m) { return /flash/i.test(m.id); });
        if (!pool.length) pool = models.slice();
        pool.sort(function (a, b) { return version(b) - version(a); });
        return pool.length ? pool[0].id : null;
      },

      /** Models that rejected the request to skip "thinking". Copying numbers needs no reasoning. */
      noThinkingControl: {},

      generateJson: async function (opts) {
        var body = {
          contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' }
        };
        if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
        if (opts.providerSchema) body.generationConfig.responseSchema = opts.providerSchema;
        // Gemini "thinking" models spend many seconds reasoning before they reply. Reading printed
        // amounts needs none of it, so ask for no thinking, unless this model has refused that before.
        var askedNoThinking = !this.noThinkingControl[opts.model];
        if (askedNoThinking) body.generationConfig.thinkingConfig = { thinkingBudget: 0 };

        var res = await fetch(this.base + '/' + opts.model + ':generateContent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.key },
          body: JSON.stringify(body),
          signal: opts.signal
        });
        var json = await res.json().catch(function () { return null; });
        if (!res.ok && res.status === 400 && askedNoThinking && /thinking/i.test(JSON.stringify(json || ''))) {
          this.noThinkingControl[opts.model] = true;      // this model must think; ask again without the setting
          return this.generateJson(opts);
        }
        if (!res.ok) throw httpError(res, json);
        if (!json) throw new SyntaxError('Empty reply');
        var parts = (((json.candidates || [])[0] || {}).content || {}).parts || [];
        return parts.map(function (p) { return p.text || ''; }).join('');
      }
    }
  };

  /* ---------- Connection state (session only) ---------- */

  var status = { state: 'disconnected', provider: 'gemini', model: null, models: [], message: 'No API key connected' };
  var listeners = [];

  function store(k, v) {
    try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) { /* storage blocked */ }
  }
  function read(k) {
    try { return sessionStorage.getItem(k); } catch (e) { return null; }
  }
  function setStatus(patch) {
    Object.keys(patch).forEach(function (k) { status[k] = patch[k]; });
    listeners.forEach(function (fn) { fn(getStatus()); });
  }
  function getStatus() {
    return {
      state: status.state, provider: status.provider, providerLabel: PROVIDERS[status.provider].label,
      model: status.model, models: status.models.slice(), message: status.message,
      connected: status.state === 'connected'
    };
  }

  function explain(err) {
    if (err && (err.status === 400 || err.status === 401 || err.status === 403)) {
      return 'The provider rejected this key. Check that you copied the whole key.';
    }
    if (err && err.status === 429) return 'The provider is rate-limiting this key. Wait a minute and try again.';
    if (err && err.status) return 'The provider returned an error (' + err.status + '). Try again.';
    return 'Could not reach the provider. Check your connection and try again.';
  }

  async function connect(key, providerId) {
    key = String(key || '').trim();
    providerId = providerId || status.provider;
    var provider = PROVIDERS[providerId];
    if (!provider) throw new Error('Unknown provider');
    if (!key) {
      setStatus({ state: 'error', message: 'Paste an API key first.' });
      return getStatus();
    }
    setStatus({ state: 'connecting', provider: providerId, message: 'Checking key…' });
    try {
      var models = await provider.listModels(key);
      if (!models.length) throw Object.assign(new Error('No usable models'), { status: 404 });
      var saved = read(MODEL_STORE);
      var model = models.some(function (m) { return m.id === saved; }) ? saved : provider.pickDefaultModel(models);
      store(KEY_STORE, key);
      store(PROVIDER_STORE, providerId);
      store(MODEL_STORE, model);
      setStatus({ state: 'connected', models: models, model: model, message: 'Connected to ' + provider.label });
      if (TRP.log) TRP.log('ai.connect', { provider: providerId, model: model, result: 'pass' });
    } catch (err) {
      store(KEY_STORE, null);
      setStatus({ state: 'error', models: [], model: null, message: explain(err) });
      if (TRP.log) TRP.log('ai.connect', { provider: providerId, result: 'fail', status: err.status || 'network' });
    }
    return getStatus();
  }

  function disconnect() {
    store(KEY_STORE, null);
    store(MODEL_STORE, null);
    setStatus({ state: 'disconnected', models: [], model: null, message: 'No API key connected' });
    if (TRP.log) TRP.log('ai.disconnect', {});
  }

  function setModel(id) {
    if (!status.models.some(function (m) { return m.id === id; })) return;
    store(MODEL_STORE, id);
    setStatus({ model: id });
  }

  /** Re-checks a key left in sessionStorage after a reload in the same tab. */
  function restore() {
    var key = read(KEY_STORE);
    if (key) return connect(key, read(PROVIDER_STORE) || 'gemini');
    return Promise.resolve(getStatus());
  }

  /* ---------- The one entry point for model calls ---------- */

  /**
   * callJson({ purpose, system, prompt, schema, providerSchema })
   * Returns { ok: true, data } or { ok: false, manual: true, reason }.
   * `prompt` is redacted here, so callers cannot forget to do it.
   */
  var TIMEOUT_MS = 45000;

  async function callJson(opts) {
    var key = read(KEY_STORE);
    if (!key || status.state !== 'connected') {
      return { ok: false, manual: true, reason: 'No AI connected' };
    }
    var provider = PROVIDERS[status.provider];
    var request = {
      key: key, model: status.model, system: opts.system,
      prompt: redact(opts.prompt), providerSchema: opts.providerSchema
    };
    var lastReason = '';
    for (var attempt = 1; attempt <= 2; attempt++) {
      var started = Date.now();
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
      request.signal = controller.signal;
      var timedOut = false, rateLimited = false;
      try {
        var text = await provider.generateJson(request);
        var data = JSON.parse(text);
        var errors = validate(opts.schema, data);
        if (!errors.length) {
          clearTimeout(timer);
          if (TRP.log) TRP.log('ai.call', { purpose: opts.purpose, model: status.model, attempt: attempt, seconds: (Date.now() - started) / 1000, result: 'pass', output: data });
          return { ok: true, data: data };
        }
        lastReason = 'Schema check failed: ' + errors.slice(0, 3).join('; ');
      } catch (err) {
        timedOut = controller.signal.aborted;
        rateLimited = err && err.status === 429;
        lastReason = timedOut ? 'The AI took longer than ' + TIMEOUT_MS / 1000 + ' seconds'
          : err instanceof SyntaxError ? 'Reply was not valid JSON' : explain(err);
      }
      clearTimeout(timer);
      if (TRP.log) TRP.log('ai.call', { purpose: opts.purpose, model: status.model, attempt: attempt, seconds: (Date.now() - started) / 1000, result: 'fail', reason: lastReason });
      if (timedOut || rateLimited) break;  // a second wait would only double the delay
    }
    return { ok: false, manual: true, reason: lastReason };
  }

  TRP.ai = {
    providers: PROVIDERS,
    connect: connect,
    disconnect: disconnect,
    restore: restore,
    setModel: setModel,
    getStatus: getStatus,
    onStatus: function (fn) { listeners.push(fn); },
    callJson: callJson,
    redact: redact,
    maskTin: maskTin,
    validate: validate
  };
})();
