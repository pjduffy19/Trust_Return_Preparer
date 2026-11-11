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
  var MODEL_STORE = 'trp-ai-model-choice';   // set only when the user picks a model in Settings
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

  /** Full SSNs, ITINs and EINs in a string, with their positions. Already-truncated numbers are left alone. */
  function findTins(text) {
    var found = [], s = String(text == null ? '' : text);
    TIN_PATTERNS.slice(0, 3).forEach(function (re, i) {
      var g = new RegExp(re.source, 'g'), m;
      while ((m = g.exec(s))) {
        var overlaps = found.some(function (f) { return m.index < f.index + f.length && f.index < m.index + m[0].length; });
        if (!overlaps) found.push({ index: m.index, length: m[0].length, kind: i === 1 ? 'ein' : 'ssn', text: m[0] });
      }
    });
    return found;
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

      /**
       * Orders the key's models for reading documents: Flash-Lite first (fast, and it can keep its
       * "thinking" to a minimum), then Flash, newest version first, stable before preview.
       * Names are read from the key's own model list; nothing is hard-coded.
       */
      rankModels: function (models) {
        var skip = /(tts|image|live|audio|embedding|vision|learn|exp|computer|robotics|native)/i;
        var version = function (id) { var v = /gemini-(\d+(?:\.\d+)?)/i.exec(id); return v ? parseFloat(v[1]) : 0; };
        var group = function (id) {
          var lite = /flash-lite/i.test(id), flash = /flash/i.test(id), preview = /preview/i.test(id);
          return lite && !preview ? 0 : flash && !lite && !preview ? 1 : lite ? 2 : flash ? 3 : 9;
        };
        return models.map(function (m) { return m.id; })
          .filter(function (id) { return /gemini/i.test(id) && /flash/i.test(id) && !skip.test(id); })
          .sort(function (a, b) { return group(a) - group(b) || version(b) - version(a) || a.length - b.length; });
      },

      /**
       * How to ask each model for the least "thinking". Copying printed amounts needs none, and thinking
       * is what makes replies slow. Gemini 2.5 takes a token budget; Gemini 3 and later take a level,
       * and not every model accepts every level, so each is tried in turn and the first accepted is kept.
       */
      thinkingSteps: function (id) {
        var v = /gemini-(\d+(?:\.\d+)?)/i.exec(id);
        if (v && parseFloat(v[1]) < 3) return [{ thinkingBudget: 0 }, null];
        return [{ thinkingLevel: 'minimal' }, { thinkingLevel: 'low' }, null];
      },
      thinkingIndex: {},

      generateJson: async function (opts) {
        var steps = this.thinkingSteps(opts.model);
        for (;;) {
          var idx = this.thinkingIndex[opts.model] || 0;
          var thinking = steps[Math.min(idx, steps.length - 1)];
          var body = {
            contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
            generationConfig: { temperature: 0, responseMimeType: 'application/json' }
          };
          if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
          if (opts.providerSchema) body.generationConfig.responseSchema = opts.providerSchema;
          if (thinking) body.generationConfig.thinkingConfig = thinking;

          var res = await fetch(this.base + '/' + opts.model + ':generateContent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.key },
            body: JSON.stringify(body),
            signal: opts.signal
          });
          var json = await res.json().catch(function () { return null; });
          if (!res.ok && res.status === 400 && thinking && idx < steps.length - 1 && /think/i.test(JSON.stringify(json || ''))) {
            this.thinkingIndex[opts.model] = idx + 1;      // this model refused that setting; try the next one
            continue;
          }
          if (!res.ok) throw httpError(res, json);
          if (!json) throw new SyntaxError('Empty reply');
          var parts = (((json.candidates || [])[0] || {}).content || {}).parts || [];
          return {
            text: parts.filter(function (p) { return !p.thought; }).map(function (p) { return p.text || ''; }).join(''),
            thinking: thinking ? JSON.stringify(thinking) : 'model default'
          };
        }
      }
    }
  };

  /* ---------- Connection state (session only) ---------- */

  var status = { state: 'disconnected', provider: 'gemini', model: null, models: [], ranked: [], message: 'No API key connected' };
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
    if (err && err.status === 429) return 'The provider is rate-limiting this key (429)';
    if (err && (err.status === 503 || err.status === 500 || err.status === 502 || err.status === 504)) return 'The model is busy or unavailable (' + err.status + ')';
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
      var ranked = provider.rankModels(models);
      var saved = read(MODEL_STORE);
      var model = models.some(function (m) { return m.id === saved; }) ? saved : ranked[0] || models[0].id;
      store(KEY_STORE, key);
      store(PROVIDER_STORE, providerId);
      setStatus({ state: 'connected', models: models, ranked: ranked, model: model, message: 'Connected to ' + provider.label });
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
    setStatus({ state: 'disconnected', models: [], ranked: [], model: null, message: 'No API key connected' });
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
  var TIMEOUT_MS = 30000;        // one call
  var BUDGET_MS = 75000;         // all attempts for one item, across fallback models
  var REST_MS = 120000;          // how long a busy model is skipped
  var resting = {};              // model id -> time it was found busy

  function busyError(err, aborted) {
    return aborted || (err && [429, 500, 502, 503, 504].indexOf(err.status) !== -1) || (err && !err.status && !(err instanceof SyntaxError));
  }

  async function callJson(opts) {
    var key = read(KEY_STORE);
    if (!key || status.state !== 'connected') {
      return { ok: false, manual: true, reason: 'No AI connected' };
    }
    var provider = PROVIDERS[status.provider];
    var prompt = redact(opts.prompt);
    var deadline = Date.now() + BUDGET_MS;
    var now = Date.now();
    var isResting = function (id) { return resting[id] && now - resting[id] < REST_MS; };
    // The chosen model first, then the ranked list; models found busy in the last two minutes go last.
    var order = [status.model].concat(status.ranked.filter(function (id) { return id !== status.model; }));
    order = order.filter(function (id) { return !isResting(id); }).concat(order.filter(isResting)).slice(0, 3);

    var lastReason = '', tried = [];
    for (var m = 0; m < order.length; m++) {
      var model = order[m];
      for (var attempt = 1; attempt <= 2; attempt++) {
        var left = deadline - Date.now();
        if (left < 5000) break;
        var started = Date.now();
        var controller = new AbortController();
        var limit = Math.min(TIMEOUT_MS, left);
        var timer = setTimeout(function () { controller.abort(); }, limit);
        var busy = false, fatal = false, thinking = '';
        try {
          var reply = await provider.generateJson({ key: key, model: model, system: opts.system, prompt: prompt, providerSchema: opts.providerSchema, signal: controller.signal });
          thinking = reply.thinking;
          var data = JSON.parse(reply.text);
          var errors = validate(opts.schema, data);
          if (!errors.length) {
            clearTimeout(timer);
            if (TRP.log) TRP.log('ai.call', { purpose: opts.purpose, model: model, thinking: thinking, attempt: attempt, seconds: (Date.now() - started) / 1000, result: 'pass', output: data });
            if (model !== status.model) {
              if (TRP.log) TRP.log('ai.fallback', { from: status.model, to: model, reason: lastReason });
              setStatus({ model: model });
            }
            return { ok: true, data: data, model: model };
          }
          lastReason = 'Schema check failed: ' + errors.slice(0, 3).join('; ');
        } catch (err) {
          var aborted = controller.signal.aborted;
          busy = busyError(err, aborted);
          fatal = !busy && err && err.status >= 400 && err.status < 500;   // a bad key or request: another model will not help
          lastReason = aborted ? 'The AI took longer than ' + Math.round(limit / 1000) + ' seconds'
            : err instanceof SyntaxError ? 'Reply was not valid JSON' : explain(err);
        }
        clearTimeout(timer);
        if (TRP.log) TRP.log('ai.call', { purpose: opts.purpose, model: model, thinking: thinking || undefined, attempt: attempt, seconds: (Date.now() - started) / 1000, result: 'fail', reason: lastReason });
        if (fatal) return { ok: false, manual: true, reason: lastReason, tried: tried.concat(model) };
        if (busy) { resting[model] = Date.now(); break; }   // busy or slow: move on to the next model
      }
      tried.push(model);
    }
    return { ok: false, manual: true, reason: lastReason, tried: tried };
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
    findTins: findTins,
    maskTin: maskTin,
    validate: validate
  };
})();
