/**
 * Spolehlivé ukládání interakčního logu mimo jsPsych (sessionStorage + záloha v paměti).
 * Každá akce se zapíše okamžitě; při exportu je k dispozici celý seznam action_logs.
 */
(function (global) {
  const PREFIX = 'digitool_action_logs_';

  const scopeKey = (respondentId, scope) =>
    `${PREFIX}${respondentId || 'anon'}_${scope || 'default'}`;

  const read = (respondentId, scope) => {
    try {
      const raw = sessionStorage.getItem(scopeKey(respondentId, scope));
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('DigitoolActionLogStore.read failed', e);
      return [];
    }
  };

  const write = (respondentId, scope, entries) => {
    try {
      sessionStorage.setItem(
        scopeKey(respondentId, scope),
        JSON.stringify(Array.isArray(entries) ? entries : [])
      );
      return true;
    } catch (e) {
      console.warn('DigitoolActionLogStore.write failed', e);
      return false;
    }
  };

  const clear = (respondentId, scope) => {
    try {
      sessionStorage.removeItem(scopeKey(respondentId, scope));
    } catch (e) {
      console.warn('DigitoolActionLogStore.clear failed', e);
    }
  };

  const append = (respondentId, scope, entry) => {
    const arr = read(respondentId, scope);
    arr.push(entry);
    write(respondentId, scope, arr);
    return arr;
  };

  const normalizeEntry = (item) => {
    if (typeof item !== 'object' || item === null) {
      return { time: Date.now(), action: String(item) };
    }
    const entry = item.time ? { ...item } : { time: Date.now(), ...item };
    if (!entry.action && entry.type) {
      entry.action = entry.type;
      delete entry.type;
    }
    if (!entry.action) entry.action = 'unknown_action';
    return entry;
  };

  /** Přepojí .push() na poli tak, aby každý zápis šel i do sessionStorage. */
  const wireArray = (respondentId, scope, memoryArray, options = {}) => {
    const { reset = false, taskName = null } = options;
    if (reset) clear(respondentId, scope);
    const rawPush = memoryArray.push.bind(memoryArray);
    memoryArray.push = function (...items) {
      items.forEach((item) => {
        const entry = normalizeEntry(item);
        if (taskName && !entry.task_name) entry.task_name = taskName;
        rawPush(entry);
        append(respondentId, scope, entry);
      });
      return memoryArray.length;
    };
    return memoryArray;
  };

  /** Vytvoří logger: zapisuje do paměťového pole i do sessionStorage. */
  const createLogger = (respondentId, scope, memoryArray, options = {}) => {
    const { reset = false } = options;
    if (reset) clear(respondentId, scope);
    const log = (action, detail = {}) => {
      const entry = {
        time: Date.now(),
        action,
        ...detail
      };
      memoryArray.push(entry);
      append(respondentId, scope, entry);
      return entry;
    };
    return log;
  };

  const bindTrialOnFinish = (trialOrTrials, getMemoryLogs, scope) => {
    if (Array.isArray(trialOrTrials)) {
      const respondentId = getMemoryLogs;
      const sc = scope || 'default';
      return trialOrTrials.map((trial) =>
        bindTrialOnFinish(trial, () => read(respondentId, sc))
      );
    }
    const trial = trialOrTrials;
    const prev = trial.on_finish;
    trial.on_finish = function (data) {
      const logs =
        typeof getMemoryLogs === 'function' ? getMemoryLogs() : getMemoryLogs;
      if (Array.isArray(logs) && logs.length > 0) {
        data.action_logs = logs.map((e) => normalizeEntry(e));
      }
      if (typeof prev === 'function') prev.call(this, data);
    };
    return trial;
  };

  const mergeTrialsWithStoredLogs = (trials, storedLogs) => {
    if (!Array.isArray(trials)) return [];
    if (!storedLogs.length) return trials;
    const hasAnyTrialLogs = trials.some(
      (t) => Array.isArray(t.action_logs) && t.action_logs.length > 0
    );
    if (hasAnyTrialLogs) return trials;
    return trials.map((t, i) => {
      const name = t.task_name;
      let logs = [];
      if (name) {
        logs = storedLogs.filter((e) => e.task_name === name);
      }
      if (!logs.length && i === trials.length - 1) {
        logs = storedLogs;
      }
      return { ...t, action_logs: logs };
    });
  };

  const UPLOAD_URL = 'https://script.google.com/macros/s/AKfycbyANMdl655_EgkUClCXONgoYJszYTA9t3k3Ed-JYhLoUYvfM_95sQasW_Er1oJKQCI/exec';
  const MIN_UPLOAD_GAP_MS = 3 * 60 * 1000;
  let uploadBusy = false;

  const uploadStateKey = (respondentId, scope) =>
    `digitool_upload_state_${scope || 'uloha'}_${respondentId || 'bez_id'}`;

  const readUploadState = (respondentId, scope) => {
    try {
      const raw = sessionStorage.getItem(uploadStateKey(respondentId, scope));
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  };

  const writeUploadState = (respondentId, scope, signature) => {
    try {
      sessionStorage.setItem(uploadStateKey(respondentId, scope), JSON.stringify({
        signature,
        at: Date.now()
      }));
    } catch (e) { /* ignore */ }
  };

  const logSignature = (respondentId, scope) => {
    const logs = read(respondentId, scope);
    if (!logs.length) return '';
    const last = logs[logs.length - 1] || {};
    return `${scope || ''}|${respondentId || ''}|${logs.length}|${last.time || ''}|${last.action || ''}`;
  };

  const buildActionLogsBody = (respondentId, scope) => {
    const logs = read(respondentId, scope).map((entry) => ({ ...entry }));
    if (!logs.length) return null;
    const safeId = String(respondentId || 'bez_id').replace(/[^\w.-]+/g, '_');
    const filename = `DigiTool_${safeId}_${scope || 'uloha'}_prubeh.json`;
    const content = JSON.stringify({
      respondent_id: respondentId || null,
      task: scope || null,
      partial: true,
      saved_at: new Date().toISOString(),
      action_logs: logs
    });
    return 'payload=' + encodeURIComponent(JSON.stringify({ filename, content }));
  };

  const postPayload = (body) => fetch(UPLOAD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body
  }).then((res) => res.text()).then((text) => {
    if (text.indexOf('"ok":false') !== -1 || text.indexOf('"ok": false') !== -1) return false;
    return true;
  });

  const uploadActionLogsCopy = (respondentId, scope, options = {}) => {
    if (!UPLOAD_URL || uploadBusy) return Promise.resolve(false);
    const signature = logSignature(respondentId, scope);
    if (!signature) return Promise.resolve(false);
    const state = readUploadState(respondentId, scope);
    if (state && state.signature === signature) return Promise.resolve(false);
    if (!options.force && state && Date.now() - state.at < MIN_UPLOAD_GAP_MS) return Promise.resolve(false);
    const body = buildActionLogsBody(respondentId, scope);
    if (!body) return Promise.resolve(false);
    uploadBusy = true;
    writeUploadState(respondentId, scope, signature);
    return postPayload(body).catch((err) => {
      console.warn('DigiTool průběžné odeslání logu:', err);
      return true;
    }).then((ok) => {
      if (!ok) {
        try { sessionStorage.removeItem(uploadStateKey(respondentId, scope)); } catch (e) { /* ignore */ }
      }
      return ok;
    }).finally(() => {
      uploadBusy = false;
    });
  };

  const watchProgress = (respondentId, scope) => {
    setInterval(() => {
      uploadActionLogsCopy(respondentId, scope);
    }, MIN_UPLOAD_GAP_MS);
    window.addEventListener('pagehide', () => {
      const signature = logSignature(respondentId, scope);
      const state = readUploadState(respondentId, scope);
      if (!signature || (state && state.signature === signature)) return;
      const body = buildActionLogsBody(respondentId, scope);
      if (!body || !navigator.sendBeacon) return;
      writeUploadState(respondentId, scope, signature);
      const blob = new Blob([body], { type: 'application/x-www-form-urlencoded;charset=utf-8' });
      try { navigator.sendBeacon(UPLOAD_URL, blob); } catch (e) { /* ignore */ }
    });
  };

  global.DigitoolActionLogStore = {
    read,
    write,
    clear,
    append,
    normalizeEntry,
    wireArray,
    createLogger,
    bindTrialOnFinish,
    mergeTrialsWithStoredLogs,
    uploadActionLogsCopy,
    sendActionLogsBeacon: () => false,
    watchProgress
  };
})(typeof window !== 'undefined' ? window : globalThis);
