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

  /** Pulls a JSON object out of a reply, tolerating code fences or a sentence around it. */
  function extractJson(text) {
    var t = String(text || '').trim();
    try { return JSON.parse(t); } catch (e) { /* fall through */ }
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    var a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a !== -1 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new SyntaxError('No JSON in reply');
  }

  /** A fetch that marks a network-level failure (no response at all, often a browser CORS block). */
  async function call(url, init) {
    try { return await fetch(url, init); }
    catch (err) {
      if (err && err.name === 'AbortError') throw err;
      var e = new Error('Network error'); e.network = true; throw e;
    }
  }

  function versionOf(id, re) { var v = re.exec(id); return v ? parseFloat(v[1]) : 0; }

  /**
   * OpenAI-style chat completions, shared by OpenAI and OpenRouter. Some models refuse a setting
   * (temperature, JSON mode, reasoning effort); the refusal is remembered per model and the call
   * is repeated without it.
   */
  function chatProvider(cfg) {
    var refuses = {};   // model -> { temperature, json, reasoningStep }
    return Object.assign(cfg, {
      generateJson: async function (opts) {
        var r = refuses[opts.model] = refuses[opts.model] || { reasoningStep: 0 };
        var steps = cfg.reasoningSteps ? cfg.reasoningSteps(opts.model) : [null];
        for (var guard = 0; guard < 8; guard++) {
          var effort = steps[Math.min(r.reasoningStep, steps.length - 1)];
          var body = { model: opts.model, messages: [] };
          if (opts.system) body.messages.push({ role: 'system', content: opts.system });
          body.messages.push({ role: 'user', content: opts.prompt });
          if (!r.temperature && !(cfg.noTemperature && cfg.noTemperature(opts.model))) body.temperature = 0;
          if (!r.json) body.response_format = { type: 'json_object' };
          if (effort) body.reasoning_effort = effort;
          var res = await call(cfg.base + '/chat/completions', {
            method: 'POST', signal: opts.signal,
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + opts.key },
            body: JSON.stringify(body)
          });
          var json = await res.json().catch(function () { return null; });
          if (!res.ok && res.status === 400) {
            var msg = JSON.stringify(json || '').toLowerCase();
            if (body.temperature !== undefined && /temperature/.test(msg)) { r.temperature = true; continue; }
            if (effort && /reasoning/.test(msg)) { r.reasoningStep++; continue; }
            if (body.response_format && /response_format|json/.test(msg)) { r.json = true; continue; }
          }
          if (!res.ok) throw httpError(res, json);
          if (!json) throw new SyntaxError('Empty reply');
          var choice = (json.choices || [])[0] || {};
          return { text: (choice.message && choice.message.content) || '', thinking: effort ? 'reasoning ' + effort : 'model default' };
        }
        throw new Error('The model refused every setting');
      }
    });
  }

  var PROVIDERS = {
    gemini: {
      id: 'gemini',
      label: 'Google Gemini',
      keyHelpUrl: 'https://aistudio.google.com/app/apikey',
      keyHelpText: 'Get a free Gemini key',
      keyPlaceholder: 'Paste your Gemini key',
      note: 'Free tier available. The default.',
      base: 'https://generativelanguage.googleapis.com/v1beta',

      /** Lists the text models this key can use. Doubles as the connection test. */
      listModels: async function (key) {
        var res = await call(this.base + '/models?pageSize=200', {
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
        var group = function (id) {
          var lite = /flash-lite/i.test(id), flash = /flash/i.test(id), preview = /preview/i.test(id);
          return lite && !preview ? 0 : flash && !lite && !preview ? 1 : lite ? 2 : flash ? 3 : 9;
        };
        return models.map(function (m) { return m.id; })
          .filter(function (id) { return /gemini/i.test(id) && /flash/i.test(id) && !skip.test(id); })
          .sort(function (a, b) { return group(a) - group(b) || versionOf(b, /gemini-(\d+(?:\.\d+)?)/i) - versionOf(a, /gemini-(\d+(?:\.\d+)?)/i) || a.length - b.length; });
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

          var res = await call(this.base + '/' + opts.model + ':generateContent', {
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
    },

    openai: chatProvider({
      id: 'openai',
      label: 'OpenAI',
      keyHelpUrl: 'https://platform.openai.com/api-keys',
      keyHelpText: 'Get an OpenAI key',
      keyPlaceholder: 'Paste key (sk-…)',
      note: 'Paid. OpenAI does not always accept calls from web pages; if it is blocked, use OpenRouter for the same models.',
      blockedHelp: 'OpenAI may not accept calls made directly from a web page. Use OpenRouter to reach the same models with one key.',
      base: 'https://api.openai.com/v1',
      listModels: async function (key) {
        var res = await call(this.base + '/models', { headers: { Authorization: 'Bearer ' + key } });
        var body = await res.json().catch(function () { return null; });
        if (!res.ok) throw httpError(res, body);
        var skip = /(audio|realtime|tts|transcribe|image|search|embedding|instruct|codex|moderation|dall-e|whisper|computer|davinci|babbage|deep-research|oss)/i;
        return ((body && body.data) || []).map(function (m) { return m.id; })
          .filter(function (id) { return /^(gpt-|o\d|chatgpt-)/i.test(id) && !skip.test(id); })
          .sort()
          .map(function (id) { return { id: id, label: id }; });
      },
      /** Small, fast chat models first (mini, then nano, then full size), newest version first; reasoning "o" models last. */
      rankModels: function (models) {
        var ver = function (id) { return versionOf(id, /gpt-(\d+(?:\.\d+)?)/i); };
        var group = function (id) {
          var dated = /-\d{4}-\d{2}-\d{2}$/.test(id);
          var g = /^o\d/i.test(id) ? 6 : /mini/i.test(id) ? 0 : /nano/i.test(id) ? 1 : /^chatgpt/i.test(id) ? 5 : 2;
          return g + (dated ? 0.5 : 0);
        };
        return models.map(function (m) { return m.id; })
          .sort(function (a, b) { return group(a) - group(b) || ver(b) - ver(a) || a.length - b.length; });
      },
      /** GPT-5 and the o-series are reasoning models: they take an effort level and reject temperature. */
      reasoningSteps: function (id) { return /^(o\d|gpt-5)/i.test(id) ? ['minimal', 'low', null] : [null]; },
      noTemperature: function (id) { return /^(o\d|gpt-5)/i.test(id); }
    }),

    anthropic: {
      id: 'anthropic',
      label: 'Anthropic Claude',
      keyHelpUrl: 'https://console.anthropic.com/settings/keys',
      keyHelpText: 'Get an Anthropic key',
      keyPlaceholder: 'Paste key (sk-ant-…)',
      note: 'Paid.',
      base: 'https://api.anthropic.com/v1',
      headers: function (key) {
        return {
          'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json',
          // Anthropic's opt-in for calls made directly from a web page with the user's own key.
          'anthropic-dangerous-direct-browser-access': 'true'
        };
      },
      listModels: async function (key) {
        var res = await call(this.base + '/models?limit=100', { headers: this.headers(key) });
        var body = await res.json().catch(function () { return null; });
        if (!res.ok) throw httpError(res, body);
        return ((body && body.data) || []).filter(function (m) { return /^claude/i.test(m.id); })
          .map(function (m) { return { id: m.id, label: m.display_name || m.id, created: m.created_at || '' }; });
      },
      /** Haiku first (fast), then Sonnet, then Opus; newest first within each. */
      rankModels: function (models) {
        var group = function (m) { return /haiku/i.test(m.id) ? 0 : /sonnet/i.test(m.id) ? 1 : /opus/i.test(m.id) ? 2 : 3; };
        return models.slice().sort(function (a, b) {
          return group(a) - group(b) || String(b.created).localeCompare(String(a.created)) || a.id.length - b.id.length;
        }).map(function (m) { return m.id; });
      },
      refuses: {},
      generateJson: async function (opts) {
        var r = this.refuses[opts.model] = this.refuses[opts.model] || {};
        for (var guard = 0; guard < 3; guard++) {
          var body = { model: opts.model, max_tokens: 4096, messages: [{ role: 'user', content: opts.prompt }] };
          if (opts.system) body.system = opts.system + ' Reply with a single JSON object and nothing else.';
          if (!r.temperature) body.temperature = 0;
          var res = await call(this.base + '/messages', { method: 'POST', signal: opts.signal, headers: this.headers(opts.key), body: JSON.stringify(body) });
          var json = await res.json().catch(function () { return null; });
          if (!res.ok && res.status === 400 && body.temperature !== undefined && /temperature/i.test(JSON.stringify(json || ''))) { r.temperature = true; continue; }
          if (!res.ok) throw httpError(res, json);
          if (!json) throw new SyntaxError('Empty reply');
          return { text: (json.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join(''), thinking: 'none' };
        }
        throw new Error('The model refused every setting');
      }
    },

    openrouter: chatProvider({
      id: 'openrouter',
      label: 'OpenRouter (many models)',
      keyHelpUrl: 'https://openrouter.ai/settings/keys',
      keyHelpText: 'Get an OpenRouter key',
      keyPlaceholder: 'Paste key (sk-or-…)',
      note: 'One key for models from OpenAI, Anthropic, Google, Meta, Mistral and others, including some free ones.',
      base: 'https://openrouter.ai/api/v1',
      listModels: async function (key) {
        // Checks the key first: the model list itself is public and would accept any key.
        var check = await call(this.base + '/key', { headers: { Authorization: 'Bearer ' + key } });
        var info = await check.json().catch(function () { return null; });
        if (!check.ok) throw httpError(check, info);
        this.freeTier = !!(info && info.data && info.data.is_free_tier);
        var res = await call(this.base + '/models', { headers: { Authorization: 'Bearer ' + key } });
        var body = await res.json().catch(function () { return null; });
        if (!res.ok) throw httpError(res, body);
        return ((body && body.data) || []).filter(function (m) {
          var arch = m.architecture || {};
          var out = arch.output_modalities || ['text'], inp = arch.input_modalities || ['text'];
          return out.indexOf('text') !== -1 && out.length === 1 && inp.indexOf('text') !== -1;
        }).map(function (m) {
          var p = m.pricing || {}, free = String(p.prompt) === '0' && String(p.completion) === '0';
          return { id: m.id, label: (m.name || m.id) + (free ? ' (free)' : ''), free: free };
        }).sort(function (a, b) { return a.label.localeCompare(b.label); });
      },
      /** Fast families first. A key on the free tier starts with the free versions. */
      rankModels: function (models) {
        var free = this.freeTier;
        var fam = function (id) {
          return /gemini.*flash-lite/i.test(id) ? 0 : /gemini.*flash/i.test(id) ? 1 : /gpt.*mini/i.test(id) ? 2 : /claude.*haiku/i.test(id) ? 3 : 9;
        };
        return models.filter(function (m) { return fam(m.id) < 9 && !/preview|exp/i.test(m.id); })
          .sort(function (a, b) { return (free ? (b.free ? 1 : 0) - (a.free ? 1 : 0) : 0) || fam(a.id) - fam(b.id) || b.id.localeCompare(a.id); })
          .map(function (m) { return m.id; });
      }
    })
  };

  /* ---------- Connection state (session only) ---------- */

  var status = { state: 'disconnected', provider: 'gemini', model: null, models: [], ranked: [], userChose: false, message: 'No API key connected' };
  var listeners = [];

  function modelStore(providerId) { return MODEL_STORE + ':' + providerId; }

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
    var label = '';
    status.models.forEach(function (m) { if (m.id === status.model) label = m.label; });
    return {
      state: status.state, provider: status.provider, providerLabel: PROVIDERS[status.provider].label,
      model: status.model, modelLabel: label, models: status.models.slice(), message: status.message,
      userChose: status.userChose, connected: status.state === 'connected'
    };
  }

  function explain(err, providerId) {
    var p = PROVIDERS[providerId || status.provider];
    if (err && err.network) {
      return 'Your browser could not reach ' + p.label + '. Check your connection.' + (p.blockedHelp ? ' ' + p.blockedHelp : '');
    }
    if (err && (err.status === 401 || err.status === 403)) return p.label + ' rejected this key. Check that you copied the whole key.';
    if (err && err.status === 400) return p.label + ' rejected the request (400): ' + String(err.message || '').slice(0, 120);
    if (err && err.status === 402) return p.label + ' says this key has no credit left (402). Add credit or choose a free model.';
    if (err && err.status === 404) return p.label + ' did not find that model (404). Choose another model in Settings.';
    if (err && err.status === 429) return p.label + ' is rate-limiting this key (429)';
    if (err && (err.status === 503 || err.status === 500 || err.status === 502 || err.status === 504 || err.status === 529)) return 'The model is busy or unavailable (' + err.status + ')';
    if (err && err.status) return p.label + ' returned an error (' + err.status + '). Try again.';
    return 'Could not reach ' + p.label + '. Check your connection and try again.';
  }

  async function connect(key, providerId) {
    key = String(key || '').trim();
    providerId = providerId || status.provider;
    var provider = PROVIDERS[providerId];
    if (!provider) throw new Error('Unknown provider');
    if (!key) {
      setStatus({ state: 'error', provider: providerId, message: 'Paste a ' + provider.label + ' API key first.' });
      return getStatus();
    }
    setStatus({ state: 'connecting', provider: providerId, message: 'Checking key with ' + provider.label + '…' });
    try {
      var models = await provider.listModels(key);
      if (!models.length) throw Object.assign(new Error('No usable models'), { status: 404 });
      var ranked = provider.rankModels(models);
      var saved = read(modelStore(providerId));
      var chose = models.some(function (m) { return m.id === saved; });
      var model = chose ? saved : ranked[0] || models[0].id;
      store(KEY_STORE, key);
      store(PROVIDER_STORE, providerId);
      setStatus({ state: 'connected', models: models, ranked: ranked, model: model, userChose: chose, message: 'Connected to ' + provider.label });
      if (TRP.log) TRP.log('ai.connect', { provider: providerId, model: model, chosenBy: chose ? 'user' : 'app', result: 'pass' });
    } catch (err) {
      store(KEY_STORE, null);
      setStatus({ state: 'error', models: [], ranked: [], model: null, userChose: false, message: err.status === 404 ? provider.label + ' found no models this key can use.' : explain(err, providerId) });
      if (TRP.log) TRP.log('ai.connect', { provider: providerId, result: 'fail', status: err.status || 'network' });
    }
    return getStatus();
  }

  function disconnect() {
    store(KEY_STORE, null);
    store(modelStore(status.provider), null);
    setStatus({ state: 'disconnected', models: [], ranked: [], model: null, userChose: false, message: 'No API key connected' });
    if (TRP.log) TRP.log('ai.disconnect', {});
  }

  /** The user's own choice of model. It is used as chosen: the app does not switch away from it. */
  function setModel(id) {
    if (id === 'auto') {
      store(modelStore(status.provider), null);
      setStatus({ model: status.ranked[0] || status.models[0].id, userChose: false });
      if (TRP.log) TRP.log('ai.model', { provider: status.provider, model: status.model, chosenBy: 'app' });
      return;
    }
    if (!status.models.some(function (m) { return m.id === id; })) return;
    store(modelStore(status.provider), id);
    setStatus({ model: id, userChose: true });
    if (TRP.log) TRP.log('ai.model', { provider: status.provider, model: id, chosenBy: 'user' });
  }

  /** Re-checks a key left in sessionStorage after a reload in the same tab. */
  function restore() {
    var key = read(KEY_STORE), provider = read(PROVIDER_STORE);
    if (key) return connect(key, PROVIDERS[provider] ? provider : 'gemini');
    if (PROVIDERS[provider]) setStatus({ provider: provider });
    return Promise.resolve(getStatus());
  }

  /** Picks the provider before a key is entered, so the form can show the right help. */
  function selectProvider(id) {
    if (!PROVIDERS[id] || status.state === 'connected' || status.state === 'connecting') return;
    store(PROVIDER_STORE, id);
    setStatus({ provider: id, state: 'disconnected', message: 'No API key connected' });
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
    return aborted || (err && [429, 500, 502, 503, 504, 529].indexOf(err.status) !== -1) || (err && !err.status && !(err instanceof SyntaxError));
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
    // A model the user picked is used on its own. Otherwise the app's pick comes first, then the ranked
    // list as fallbacks, with models found busy in the last two minutes moved to the end.
    var order = status.userChose ? [status.model] : [status.model].concat(status.ranked.filter(function (id) { return id !== status.model; }));
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
          var data = extractJson(reply.text);
          var errors = validate(opts.schema, data);
          if (!errors.length) {
            clearTimeout(timer);
            if (TRP.log) TRP.log('ai.call', { purpose: opts.purpose, model: model, thinking: thinking, attempt: attempt, seconds: (Date.now() - started) / 1000, result: 'pass', output: data });
            if (model !== status.model && !status.userChose) {
              if (TRP.log) TRP.log('ai.fallback', { from: status.model, to: model, reason: lastReason });
              setStatus({ model: model });
            }
            return { ok: true, data: data, model: model };
          }
          lastReason = 'Schema check failed: ' + errors.slice(0, 3).join('; ');
        } catch (err) {
          var aborted = controller.signal.aborted;
          busy = busyError(err, aborted) && !(err && err.network && status.userChose);
          fatal = !busy && err && (err.network || (err.status >= 400 && err.status < 500 && err.status !== 404));   // a bad key, no credit or a blocked call: another model will not help
          lastReason = aborted ? 'The AI took longer than ' + Math.round(limit / 1000) + ' seconds'
            : err instanceof SyntaxError ? 'Reply was not valid JSON' : explain(err);
        }
        clearTimeout(timer);
        if (TRP.log) TRP.log('ai.call', { purpose: opts.purpose, model: model, thinking: thinking || undefined, attempt: attempt, seconds: (Date.now() - started) / 1000, result: 'fail', reason: lastReason });
        if (fatal) return { ok: false, manual: true, reason: lastReason, tried: tried.concat(model) };
        if (busy) { resting[model] = Date.now(); break; }   // busy or slow: move on to the next model
      }
      tried.push(model);
      if (status.userChose) break;
    }
    return { ok: false, manual: true, reason: lastReason, tried: tried };
  }

  TRP.ai = {
    providers: PROVIDERS,
    connect: connect,
    disconnect: disconnect,
    restore: restore,
    setModel: setModel,
    selectProvider: selectProvider,
    extractJson: extractJson,
    getStatus: getStatus,
    onStatus: function (fn) { listeners.push(fn); },
    callJson: callJson,
    redact: redact,
    findTins: findTins,
    maskTin: maskTin,
    validate: validate
  };
})();
