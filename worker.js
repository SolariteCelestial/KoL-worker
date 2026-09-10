// Kingdom of Loathing Reverse Proxy — Cloudflare Worker
// Deploy: Cloudflare dashboard > Workers & Pages > Create > paste this in > Deploy

const TARGET_HOST = "www.kingdomofloathing.com";

function isAllowedHost(host) {
  host = (host || "").toLowerCase();
  return host === "kingdomofloathing.com" || host.endsWith(".kingdomofloathing.com");
}

function decodeProxyPath(pathname) {
  const match = pathname.match(/^\/_\/([^/]+)(\/.*)?$/);
  if (!match) return null;
  return { host: match[1], path: match[2] || "/" };
}

function toProxyPath(workerOrigin, host, path) {
  return `${workerOrigin}/_/${host}${path || "/"}`;
}

// FIX: factory function instead of module-level /gi regex — avoids shared
// lastIndex state that caused every other rewrite to silently skip.
function hostUrlRe() {
  return /(https?:)?\/\/((?:[a-z0-9-]+\.)*kingdomofloathing\.com)((?:\/[^\s"'<>)]*)?)/gi;
}

function rewriteTextContent(text, workerOrigin) {
  return text.replace(hostUrlRe(), (match, proto, host, path) => {
    return toProxyPath(workerOrigin, host, path);
  });
}

function rewriteUrl(raw, workerOrigin) {
  try {
    let abs;
    if (raw.startsWith("//")) abs = "https:" + raw;
    else if (raw.startsWith("http://") || raw.startsWith("https://")) abs = raw;
    else return null;
    const u = new URL(abs);
    if (!isAllowedHost(u.hostname)) return null;
    return toProxyPath(workerOrigin, u.hostname, u.pathname + u.search + u.hash);
  } catch {
    return null;
  }
}

function stripHopHeaders(headers) {
  const out = new Headers(headers);
  ["connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "proxy-authorization"].forEach((h) =>
    out.delete(h)
  );
  return out;
}

class AttrRewriter {
  constructor(attr, workerOrigin) {
    this.attr = attr;
    this.workerOrigin = workerOrigin;
  }
  element(el) {
    const val = el.getAttribute(this.attr);
    if (!val) return;
    const rewritten = rewriteUrl(val, this.workerOrigin);
    if (rewritten) el.setAttribute(this.attr, rewritten);
  }
}

class SrcsetRewriter {
  constructor(workerOrigin) {
    this.workerOrigin = workerOrigin;
  }
  element(el) {
    const val = el.getAttribute("srcset");
    if (!val) return;
    const rewritten = val
      .split(",")
      .map((part) => {
        const [u, size] = part.trim().split(/\s+/);
        const nu = rewriteUrl(u, this.workerOrigin) || u;
        return size ? `${nu} ${size}` : nu;
      })
      .join(", ");
    el.setAttribute("srcset", rewritten);
  }
}

class MetaRefreshRewriter {
  constructor(workerOrigin) {
    this.workerOrigin = workerOrigin;
  }
  element(el) {
    const equiv = (el.getAttribute("http-equiv") || "").toLowerCase();
    if (equiv !== "refresh") return;
    const content = el.getAttribute("content");
    if (content) el.setAttribute("content", rewriteTextContent(content, this.workerOrigin));
  }
}

class TextRewriter {
  constructor(workerOrigin) {
    this.workerOrigin = workerOrigin;
  }
  text(chunk) {
    if (hostUrlRe().test(chunk.text)) {
      chunk.replace(rewriteTextContent(chunk.text, this.workerOrigin));
    }
  }
}

function injectionScript(workerOrigin) {
  return `<script>(function(){
  var ORIGIN = ${JSON.stringify(workerOrigin)};

  function proxify(u){
    try {
      if (typeof u !== "string") return u;
      var abs;
      if (u.indexOf("//") === 0) abs = "https:" + u;
      else if (u.indexOf("http://") === 0 || u.indexOf("https://") === 0) abs = u;
      else return u;
      var parsed = new URL(abs);
      if (!/(^|\\.)kingdomofloathing\\.com$/i.test(parsed.hostname)) return u;
      return ORIGIN + "/_/" + parsed.hostname + parsed.pathname + parsed.search + parsed.hash;
    } catch(e) { return u; }
  }
  var origFetch = window.fetch;
  window.fetch = function(input, init){
    if (typeof input === "string") input = proxify(input);
    else if (input && input.url) input = new Request(proxify(input.url), input);
    return origFetch.call(this, input, init);
  };
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url){
    arguments[1] = proxify(url);
    return origOpen.apply(this, arguments);
  };
  var OrigWS = window.WebSocket;
  if (OrigWS) {
    window.WebSocket = function(url, protocols){
      // FIX: was .replace(/^http/, "ws") which left ws:// unchanged; now always wss:
      var p = proxify(url).replace(/^wss?:/, "wss:");
      return protocols ? new OrigWS(p, protocols) : new OrigWS(p);
    };
    window.WebSocket.prototype = OrigWS.prototype;
  }
})();<\/script>`;
}

function autoAdventurePanelScript() {
  return `<style>
#kol-aa-tab, #kol-aa-panel { box-sizing: border-box; }
#kol-aa-panel *, #kol-aa-panel *::before, #kol-aa-panel *::after { box-sizing: border-box; }
#kol-aa-tab {
  position: fixed; top: 50%; right: 0; transform: translateY(-50%);
  z-index: 2147483000; background: #1b1f26; color: #8b93a1;
  border: 1px solid #2a2f38; border-right: none; border-radius: 8px 0 0 8px;
  padding: 16px 9px; font: 600 12px/1.3 -apple-system, system-ui, sans-serif;
  writing-mode: vertical-rl; text-orientation: mixed; cursor: pointer;
  letter-spacing: 0.05em; user-select: none; transition: background 0.15s, border-color 0.15s;
}
#kol-aa-tab:active { background: #22262e; }
#kol-aa-tab.kol-aa-running { border-left: 3px solid #6fce8f; color: #cfd4dc; }
#kol-aa-panel {
  position: fixed; top: 0; right: 0; height: 100%; width: 300px; max-width: 86vw;
  transform: translateX(100%); transition: transform 0.22s ease;
  z-index: 2147483001; background: #14171c; color: #e6e9ef;
  border-left: 1px solid #2a2f38; box-shadow: -8px 0 24px rgba(0,0,0,0.35);
  font: 15px/1.5 -apple-system, system-ui, sans-serif;
  display: flex; flex-direction: column; padding: 16px; overflow-y: auto;
}
#kol-aa-panel.kol-aa-open { transform: translateX(0); }
#kol-aa-panel h1 {
  font-size: 14px; font-weight: 600; margin: 0 0 14px; color: #8b93a1;
  letter-spacing: 0.04em; display: flex; justify-content: space-between; align-items: center;
}
#kol-aa-close {
  background: none; border: none; color: #8b93a1; font-size: 22px; line-height: 1;
  cursor: pointer; padding: 2px 6px;
}
#kol-aa-panel label { display: block; font-size: 12px; color: #8b93a1; margin: 10px 0 5px; }
#kol-aa-panel input {
  width: 100%; background: #1b1f26; border: 1px solid #2a2f38; color: #e6e9ef;
  border-radius: 6px; padding: 9px 10px; font-size: 14px;
}
#kol-aa-panel input:focus { outline: none; border-color: #6fce8f; }
#kol-aa-row { display: flex; gap: 10px; }
#kol-aa-row > div { flex: 1; }
.kol-aa-btn {
  margin-top: 14px; padding: 10px 16px; border-radius: 6px; border: none;
  font-size: 14px; font-weight: 600; cursor: pointer;
}
#kol-aa-start { background: #6fce8f; color: #0d1f14; }
#kol-aa-stop { background: #1b1f26; color: #e6e9ef; border: 1px solid #2a2f38; margin-left: 8px; }
.kol-aa-btn:disabled { opacity: 0.4; cursor: default; }
#kol-aa-status { margin-top: 12px; font-size: 12px; color: #8b93a1; }
#kol-aa-log {
  margin-top: 8px; background: #1b1f26; border: 1px solid #2a2f38; border-radius: 6px;
  padding: 10px; flex: 1; min-height: 140px; overflow-y: auto;
  font: 12px/1.5 ui-monospace, "SF Mono", monospace; white-space: pre-wrap;
}
.kol-aa-stopped { color: #e0a84f; }
.kol-aa-err { color: #e0715f; }
.kol-aa-choice-box {
  margin-top: 12px; background: #1b1f26; border: 1px solid #2a2f38; border-radius: 6px; padding: 12px;
}
.kol-aa-choice-title { font-size: 13px; font-weight: 600; color: #e6e9ef; margin-bottom: 8px; }
.kol-aa-choice-opts { display: flex; flex-direction: column; gap: 6px; }
.kol-aa-choice-opt {
  padding: 9px 10px; border-radius: 6px; border: 1px solid #2a2f38; text-align: left;
  background: #14171c; color: #e6e9ef; font-size: 13px; font-weight: 500; cursor: pointer;
}
.kol-aa-choice-opt:active { background: #22262e; border-color: #6fce8f; }
.kol-aa-choice-note { font-size: 12px; color: #8b93a1; }
.kol-aa-choice-view { display: block; margin-top: 10px; font-size: 12px; color: #6fce8f; text-decoration: none; }
.kol-aa-choice-manual { display: flex; gap: 6px; margin-top: 10px; align-items: center; }
#kol-aa-panel .kol-aa-choice-manual input { width: 80px; }
.kol-aa-choice-manual .kol-aa-btn { margin-top: 0; }
#kol-aa-reset { display: block; margin-top: 12px; font-size: 11px; color: #8b93a1; text-decoration: none; }
#kol-aa-podcast { display: block; margin-top: 8px; font-size: 11px; color: #8b93a1; text-decoration: none; }
#kol-aa-podcast:hover { color: #6fce8f; }
</style>
<script>(function(){
  if (window.self !== window.top) return;
  if (document.getElementById('kol-aa-tab')) return;

  function ready(fn){
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function(){
    var STORE_KEY = 'kolAutoAdv';
    var CHOICES_KEY = 'kolAutoAdvChoices';
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch(e) {}
    var choices = {};
    try { choices = JSON.parse(localStorage.getItem(CHOICES_KEY) || '{}'); } catch(e) {}

    var tab = document.createElement('div');
    tab.id = 'kol-aa-tab';
    tab.textContent = 'AUTO-ADV';

    var panel = document.createElement('div');
    panel.id = 'kol-aa-panel';
    panel.innerHTML =
      '<h1>AUTO-ADVENTURE<button id="kol-aa-close">&times;<\/button><\/h1>' +
      '<label for="kol-aa-target">Adventure link<\/label>' +
      '<input id="kol-aa-target" placeholder="paste the adventure.php link">' +
      '<div id="kol-aa-row">' +
        '<div><label for="kol-aa-turns">Turns<\/label><input id="kol-aa-turns" type="number" value="10" min="1"><\/div>' +
        '<div><label for="kol-aa-macro">Macro ID<\/label><input id="kol-aa-macro" placeholder="optional"><\/div>' +
      '<\/div>' +
      '<div>' +
        '<button class="kol-aa-btn" id="kol-aa-start">Start<\/button>' +
        '<button class="kol-aa-btn" id="kol-aa-stop" disabled>Stop<\/button>' +
      '<\/div>' +
      '<div id="kol-aa-choice"><\/div>' +
      '<div id="kol-aa-status"><\/div>' +
      '<div id="kol-aa-log"><\/div>' +
      '<a id="kol-aa-reset" href="#">Clear saved choice picks<\/a>' +
      '<a id="kol-aa-podcast" href="/podcast">\uD83C\uDF99 KoL Podcast<\/a>';

    document.documentElement.appendChild(tab);
    document.documentElement.appendChild(panel);

    var targetEl = panel.querySelector('#kol-aa-target');
    var turnsEl = panel.querySelector('#kol-aa-turns');
    var macroEl = panel.querySelector('#kol-aa-macro');
    var startBtn = panel.querySelector('#kol-aa-start');
    var stopBtn = panel.querySelector('#kol-aa-stop');
    var statusEl = panel.querySelector('#kol-aa-status');
    var logEl = panel.querySelector('#kol-aa-log');
    var closeBtn = panel.querySelector('#kol-aa-close');
    var choiceEl = panel.querySelector('#kol-aa-choice');
    var resetEl = panel.querySelector('#kol-aa-reset');
    choiceEl.style.display = 'none';

    if (saved.target) targetEl.value = saved.target;
    if (saved.turns) turnsEl.value = saved.turns;
    if (saved.macroId) macroEl.value = saved.macroId;

    function persist(){
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({
          open: panel.classList.contains('kol-aa-open'),
          target: targetEl.value, turns: turnsEl.value, macroId: macroEl.value
        }));
      } catch(e) {}
    }

    function saveChoices(){
      try { localStorage.setItem(CHOICES_KEY, JSON.stringify(choices)); } catch(e) {}
    }

    function setOpen(open){
      panel.classList.toggle('kol-aa-open', open);
      tab.style.display = open ? 'none' : '';
      persist();
    }

    tab.addEventListener('click', function(){ setOpen(true); });
    closeBtn.addEventListener('click', function(){ setOpen(false); });
    if (saved.open) setOpen(true);

    function addLog(line, cls){
      var div = document.createElement('div');
      if (cls) div.className = cls;
      div.textContent = line;
      logEl.appendChild(div);
      logEl.scrollTop = logEl.scrollHeight;
    }

    resetEl.addEventListener('click', function(ev){
      ev.preventDefault();
      choices = {};
      saveChoices();
      addLog('Cleared saved choice picks.');
    });

    function setRunning(running, label){
      tab.classList.toggle('kol-aa-running', running);
      tab.textContent = running ? (label || 'RUNNING') : 'AUTO-ADV';
    }

    function escapeHtml(s){
      return String(s).replace(/[&<>"']/g, function(c){
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    function showChoicePicker(info){
      return new Promise(function(resolve, reject){
        if (!choiceEl) { reject(new Error('choice picker container missing from panel')); return; }
        var html = '<div class="kol-aa-choice-box">' +
          '<div class="kol-aa-choice-title">New choice adventure' + (info.whichchoice ? ' #' + info.whichchoice : '') + '<\/div>';
        if (info.options && info.options.length) {
          html += '<div class="kol-aa-choice-opts">';
          info.options.forEach(function(opt){
            var label = opt.label ? escapeHtml(opt.label) : ('Option ' + opt.option);
            html += '<button type="button" class="kol-aa-choice-opt" data-opt="' + opt.option + '">' + label + '<\/button>';
          });
          html += '<\/div>';
        } else {
          html += '<div class="kol-aa-choice-note">Could not detect any options automatically — use the field below.<\/div>';
        }
        if (!info.key) {
          html += '<div class="kol-aa-choice-note">Could not identify which choice this is, so the pick will not be remembered for next time.<\/div>';
        }
        html += '<a class="kol-aa-choice-view" href="' + info.viewUrl + '" target="_blank" rel="noopener">Open in game to see the real text &rarr;<\/a>';
        html += '<div class="kol-aa-choice-manual">' +
          '<input type="number" min="1" id="kol-aa-choice-num" placeholder="option #">' +
          '<button type="button" class="kol-aa-btn" id="kol-aa-choice-go">Use<\/button>' +
          '<\/div>';
        html += '<\/div>';
        choiceEl.innerHTML = html;
        choiceEl.style.display = 'block';

        function pick(opt){
          choiceEl.style.display = 'none';
          choiceEl.innerHTML = '';
          resolve(opt);
        }

        choiceEl.querySelectorAll('.kol-aa-choice-opt').forEach(function(btn){
          btn.addEventListener('click', function(){ pick(btn.getAttribute('data-opt')); });
        });

        var goBtn = choiceEl.querySelector('#kol-aa-choice-go');
        if (goBtn) {
          goBtn.addEventListener('click', function(){
            var numEl = choiceEl.querySelector('#kol-aa-choice-num');
            var val = numEl && numEl.value.trim();
            if (val) pick(val);
          });
        }
      });
    }

    var stopRequested = false;

    async function start(){
      var target = targetEl.value.trim();
      var turns = parseInt(turnsEl.value, 10);
      var macroId = macroEl.value.trim();
      if (!target || !turns) { addLog('Enter a link and a turn count first.', 'kol-aa-err'); return; }

      persist();
      stopRequested = false;
      startBtn.disabled = true;
      stopBtn.disabled = false;
      logEl.innerHTML = '';
      choiceEl.style.display = 'none';
      choiceEl.innerHTML = '';
      addLog('Starting: ' + turns + ' turns');
      setRunning(true, '0/' + turns);

      var totalDone = 0;
      var totalRequested = turns;
      var pendingResolve = null;

      while (turns > 0 && !stopRequested) {
        var params = new URLSearchParams({ target: target, turns: String(turns) });
        if (macroId) params.set('macroId', macroId);
        params.set('choices', JSON.stringify(choices));
        if (pendingResolve) {
          if (pendingResolve.whichchoice) params.set('resolveChoice', pendingResolve.whichchoice);
          params.set('resolveOption', pendingResolve.option);
          pendingResolve = null;
        }

        var data;
        try {
          var res = await fetch('/auto-adventure/run?' + params.toString());
          var raw = await res.text();
          try {
            data = JSON.parse(raw);
          } catch (e2) {
            addLog('Error: unexpected response (HTTP ' + res.status + '): ' + raw.slice(0, 200), 'kol-aa-err');
            break;
          }
        } catch (e) {
          addLog('Error: ' + e.message, 'kol-aa-err');
          break;
        }
        if (data.error) { addLog('Error: ' + data.error, 'kol-aa-err'); break; }

        data.log.forEach(function(line){ addLog(line); });
        totalDone += data.completed;
        turns = data.remaining;
        statusEl.textContent = totalDone + ' done, ' + turns + ' left';
        setRunning(true, totalDone + '/' + totalRequested);

        if (data.unknownChoice) {
          setRunning(true, 'PICK?');
          setOpen(true);
          var picked;
          try {
            picked = await showChoicePicker(data.unknownChoice);
          } catch (e3) {
            addLog('Error showing the choice picker: ' + e3.message, 'kol-aa-err');
            break;
          }
          if (data.unknownChoice.key) {
            choices[data.unknownChoice.key] = picked;
            saveChoices();
            addLog('Saved: choice ' + (data.unknownChoice.whichchoice || '?') + ' -> option ' + picked + ' (remembered for next time)');
          } else {
            addLog('Picked option ' + picked + ' — could not identify this choice, so it will ask again next time.');
          }
          pendingResolve = { whichchoice: data.unknownChoice.whichchoice, option: picked };
          continue;
        }

        if (data.stopped) { addLog('Stopped: ' + data.reason, 'kol-aa-stopped'); break; }
      }

      if (stopRequested) addLog('Stopped by you.', 'kol-aa-stopped');
      else if (turns <= 0) addLog('Done.');
      startBtn.disabled = false;
      stopBtn.disabled = true;
      setRunning(false);
    }

    function stop(){ stopRequested = true; }

    startBtn.addEventListener('click', start);
    stopBtn.addEventListener('click', stop);
    targetEl.addEventListener('change', persist);
    turnsEl.addEventListener('change', persist);
    macroEl.addEventListener('change', persist);
  });
})();<\/script>`;
}

const DEFAULT_MAX_TURNS_PER_BATCH = 10;
const MAX_ROUNDS_PER_FIGHT = 30;
const MAX_CHOICE_CHAIN = 10;

function kolAutomationHeaders(request, cookie, extra) {
  const h = new Headers(extra || {});
  h.set("Cookie", cookie);
  h.set("Referer", "https://www.kingdomofloathing.com/main.php");
  h.set("Origin", "https://www.kingdomofloathing.com");
  const ua = request && request.headers.get("User-Agent");
  if (ua) h.set("User-Agent", ua);
  return h;
}

function submitChoice(whichchoice, option, pwd, cookie, request) {
  const body = new URLSearchParams({ option: String(option), pwd });
  if (whichchoice) body.set("whichchoice", String(whichchoice));
  const headers = kolAutomationHeaders(request, cookie, { "content-type": "application/x-www-form-urlencoded" });
  return fetch("https://www.kingdomofloathing.com/choice.php", {
    method: "POST", headers, body, redirect: "follow",
  });
}

// Extracts each option's number, label, and the whichchoice value FROM THE SAME
// <form> that carries it — scoped per-form so nothing can cross-match between
// options, and so whichchoice is read the exact same reliable way as option is.
//
// FIX: KoL emits unquoted attributes as `name=whichchoice value=1308` (a space,
// not "="), not `whichchoice=1308`. The previous extraction looked for a literal
// "whichchoice=" substring, which never appears in the real markup, so
// whichchoice always came back null — that's why every pick showed "could not
// identify this choice" and had to be re-asked every time. name=X value=Y is
// the actual pattern KoL uses for every hidden input, including this one.
function parseChoiceForms(body) {
  const forms = body.match(/<form\b[^>]*>[\s\S]*?<\/form>/gi) || [];
  const results = [];
  for (const form of forms) {
    const optMatch = form.match(/name=["']?option["']?\s+value=["']?(\d+)["']?/i);
    if (!optMatch) continue;
    const whichMatch = form.match(/name=["']?whichchoice["']?\s+value=["']?(\d+)["']?/i);
    const labelMatch = form.match(/type=submit\s+value=["']([^"']+)["']/i);
    results.push({
      option: optMatch[1],
      whichchoice: whichMatch ? whichMatch[1] : null,
      label: labelMatch ? labelMatch[1] : null,
    });
  }
  return results;
}

// A composite key, not just whichchoice — see the note in resolveChoiceChain
// on why whichchoice alone isn't a safe memoization key.
function choiceKey(whichchoice, options) {
  if (!whichchoice) return null;
  const fingerprint = options.map((o) => (o.label || o.option || "").trim()).sort().join("~");
  return `${whichchoice}::${fingerprint}`;
}

async function resolveChoiceChain(res, cookie, pwd, request, knownChoices) {
  let current = res;
  for (let step = 0; step < MAX_CHOICE_CHAIN; step++) {
    const finalUrl = current.url;
    if (finalUrl.includes("login.php")) return { kind: "login" };
    if (finalUrl.includes("fight.php") || finalUrl.includes("fambattle.php")) return { kind: "fight", url: finalUrl };
    if (!finalUrl.includes("choice.php")) return { kind: "normal" };
    const body = await current.text();
    const forms = parseChoiceForms(body);

    // FIX: an "empty" choice.php page — no option= forms detected at all — is
    // not a real choice prompt to resolve or ask about. This was showing up
    // right after a saved choice successfully resolved: the game sometimes
    // routes through a transitional/summary choice.php page with no actual
    // option form on it before landing on the next real page. Previously this
    // fell through to `unknownChoice` with an empty options array, which is
    // exactly the "picker with nothing in it" bug — the saved choice had
    // already worked, there was just nothing left to pick. Treat a formless
    // page as a normal completed step and keep going instead of stopping.
    if (!forms.length) return { kind: "normal" };

    let whichchoice = new URL(finalUrl).searchParams.get("whichchoice");
    if (!whichchoice && forms.length) {
      // All option forms on one choice page should agree — take whichever
      // value is most common, as a hedge against any one stray form.
      const counts = {};
      for (const f of forms) if (f.whichchoice) counts[f.whichchoice] = (counts[f.whichchoice] || 0) + 1;
      const ranked = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
      if (ranked.length) whichchoice = ranked[0];
    }
    const options = forms.map((f) => ({ option: f.option, label: f.label }));
    // FIX: KoL can reuse the SAME whichchoice for multiple distinct steps of one
    // choice chain — confirmed from real pages: the monorail station picker and
    // its "Factory District" follow-up (a completely different set of options)
    // are both whichchoice=1308. Keying memory by whichchoice alone made every
    // remembered pick apply to BOTH steps interchangeably, which is why a saved
    // choice kept getting re-asked. Fold the option labels into the key so each
    // distinct step gets its own memory slot.
    const key = choiceKey(whichchoice, options);
    if (key && Object.prototype.hasOwnProperty.call(knownChoices, key)) {
      current = await submitChoice(whichchoice, knownChoices[key], pwd, cookie, request);
      continue;
    }
    return {
      kind: "unknownChoice",
      whichchoice: whichchoice || null,
      key,
      options,
      viewUrl: whichchoice
        ? `/_/www.kingdomofloathing.com/choice.php?whichchoice=${whichchoice}`
        : `/_/www.kingdomofloathing.com/choice.php`,
    };
  }
  return { kind: "unknownChoice", whichchoice: null, key: null, options: [], viewUrl: `/_/www.kingdomofloathing.com/choice.php` };
}

async function resolveFight(fightUrl, cookie, pwd, macroId, request) {
  let currentUrl = fightUrl;
  let previousBody = null;
  let lastBody = "";
  for (let round = 0; round < MAX_ROUNDS_PER_FIGHT; round++) {
    const body = new URLSearchParams({ action: "macro", pwd });
    if (macroId) body.set("whichmacro", macroId);
    const headers = kolAutomationHeaders(request, cookie, { "content-type": "application/x-www-form-urlencoded" });
    const res = await fetch(currentUrl.split("?")[0], {
      method: "POST", headers, body, redirect: "follow",
    });
    const text = await res.text();
    lastBody = text;
    if (!res.url.includes("fight.php") && !res.url.includes("fambattle.php")) {
      return { resolved: true, summary: `won after ${round + 1} round(s)` };
    }
    if (previousBody !== null && text === previousBody) {
      return { resolved: true, summary: `won after ${round + 1} round(s)` };
    }
    previousBody = text;
    currentUrl = res.url;
  }
  const snippet = lastBody.slice(0, 120).replace(/\s+/g, " ");
  return {
    resolved: false,
    summary: `still fighting after ${MAX_ROUNDS_PER_FIGHT} rounds — last response starts: ${snippet}`,
  };
}

// FIX: try charpane.php first — it reliably has pwd=; main.php is a frameset
async function fetchPwd(cookie, request) {
  for (const path of ["charpane.php", "main.php"]) {
    const res = await fetch(`https://www.kingdomofloathing.com/${path}`, {
      headers: kolAutomationHeaders(request, cookie),
    });
    const text = await res.text();
    const match = text.match(/pwd=([a-fA-F0-9]+)/);
    if (match) return match[1];
  }
  throw new Error("no pwd token found on charpane.php or main.php — is the session logged in?");
}

function extractKolTarget(pastedUrl) {
  const u = new URL(pastedUrl);
  if (u.hostname.endsWith("kingdomofloathing.com")) return pastedUrl;
  const m = u.pathname.match(/\/_\/(www\.kingdomofloathing\.com)(\/.*)?/);
  if (m) return `https://${m[1]}${m[2] || "/"}${u.search}`;
  return pastedUrl;
}

function withPwd(targetUrl, pwd) {
  const u = new URL(targetUrl);
  // FIX: always overwrite pwd — stale baked-in values must not be used
  u.searchParams.set("pwd", pwd);
  return u.toString();
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

async function runAutoAdventureBatch(request, url) {
  try { return await runAutoAdventureBatchCore(request, url); }
  catch (err) { return jsonResponse({ error: `unexpected worker error: ${err.message}` }, 500); }
}

async function runAutoAdventureBatchCore(request, url) {
  const rawTarget = url.searchParams.get("target");
  const turnsRequested = parseInt(url.searchParams.get("turns") || "1", 10);
  const macroId = url.searchParams.get("macroId") || null;
  const batchSize = Math.min(
    turnsRequested,
    parseInt(url.searchParams.get("batchSize") || "", 10) || DEFAULT_MAX_TURNS_PER_BATCH,
  );
  const cookie = request.headers.get("Cookie") || "";
  let knownChoices = {};
  try { knownChoices = JSON.parse(url.searchParams.get("choices") || "{}"); } catch { knownChoices = {}; }
  if (!rawTarget) return jsonResponse({ error: "missing target adventure URL" }, 400);
  if (!cookie) return jsonResponse({ error: "no session cookie on this request — open /auto-adventure through your logged-in session, not standalone" }, 400);
  let target;
  try { target = extractKolTarget(rawTarget); } catch { return jsonResponse({ error: `not a valid URL: ${rawTarget}` }, 400); }
  let pwd;
  try { pwd = await fetchPwd(cookie, request); } catch (err) { return jsonResponse({ error: `couldn't read a session token: ${err.message}` }, 502); }

  const log = [];
  let completed = 0, stopped = false, reason = null, unknownChoice = null;

  const resolveChoiceId = url.searchParams.get("resolveChoice") || null;
  const resolveOption = url.searchParams.get("resolveOption");
  const pickedLabel = resolveChoiceId ? `choice ${resolveChoiceId}` : "the choice adventure";

  if (resolveOption) {
    try {
      const res = await submitChoice(resolveChoiceId, resolveOption, pwd, cookie, request);
      const outcome = await resolveChoiceChain(res, cookie, pwd, request, knownChoices);
      if (outcome.kind === "login") {
        return jsonResponse({ completed: 0, remaining: turnsRequested, stopped: true, reason: "session expired — reopen the proxy page to log in again, then retry", log: ["resolving your pick redirected to login"] });
      }
      if (outcome.kind === "unknownChoice") {
        return jsonResponse({ completed: 0, remaining: turnsRequested, stopped: true, reason: "resolved your pick, but landed straight in another new choice adventure", unknownChoice: outcome, log: [`resolved ${pickedLabel} → option ${resolveOption}, then hit another new choice`] });
      }
      if (outcome.kind === "fight") {
        const result = await resolveFight(outcome.url, cookie, pwd, macroId, request);
        log.push(`resolved ${pickedLabel} → option ${resolveOption}, which led into a fight — ${result.summary}`);
        if (!result.resolved) {
          return jsonResponse({ completed: 0, remaining: turnsRequested, stopped: true, reason: `a fight didn't resolve after ${MAX_ROUNDS_PER_FIGHT} rounds — check that your macro is still active`, log });
        }
      } else {
        log.push(`resolved ${pickedLabel} → option ${resolveOption}`);
      }
      completed = 1;
    } catch (err) {
      return jsonResponse({ error: `couldn't resolve your choice pick: ${err.message}` }, 502);
    }
  }

  for (let i = 0; i < batchSize - completed; i++) {
    const turnNum = completed + i + 1;
    try {
      const adventureUrl = withPwd(target, pwd);
      const res = await fetch(adventureUrl, { headers: kolAutomationHeaders(request, cookie), redirect: "follow" });
      const outcome = await resolveChoiceChain(res, cookie, pwd, request, knownChoices);
      if (outcome.kind === "login") {
        stopped = true; reason = "session expired — reopen the proxy page to log in again, then retry";
        log.push(`turn ${turnNum}: redirected to login — stopping`); break;
      }
      if (outcome.kind === "unknownChoice") {
        stopped = true; unknownChoice = outcome;
        reason = `hit a new choice adventure${outcome.whichchoice ? " #" + outcome.whichchoice : ""} — pick an option to continue`;
        log.push(`turn ${turnNum}: new choice adventure${outcome.whichchoice ? " #" + outcome.whichchoice : ""} — stopping`); break;
      }
      if (outcome.kind === "fight") {
        const result = await resolveFight(outcome.url, cookie, pwd, macroId, request);
        log.push(`turn ${turnNum}: fight — ${result.summary}`);
        if (!result.resolved) {
          stopped = true; reason = `a fight didn't resolve after ${MAX_ROUNDS_PER_FIGHT} rounds — check that your macro is still active`; break;
        }
      } else {
        log.push(`turn ${turnNum}: adventured normally`);
      }
      completed++;
    } catch (err) {
      stopped = true; reason = `turn ${turnNum} hit an unexpected error: ${err.message}`;
      log.push(reason); break;
    }
  }

  return jsonResponse({ completed, remaining: turnsRequested - completed, stopped, reason, unknownChoice, log });
}

// ── PODCAST ───────────────────────────────────────────────────────────────────

const PODCAST_FILE = "The_KoL_Show_20260806.mp3";
const PODCAST_URL  = "/_/shows.kingdomofloathing.com/The_KoL_Show_20260806.mp3";

const PODCAST_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The KoL Show</title>
<style>
  :root { --bg:#14171c;--panel:#1b1f26;--line:#2a2f38;--text:#e6e9ef;--dim:#8b93a1;--accent:#6fce8f; }
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,system-ui,sans-serif;padding:24px;max-width:600px;margin:0 auto;}
  .back{display:inline-block;margin-bottom:20px;font-size:13px;color:var(--dim);text-decoration:none;}
  .back:hover{color:var(--text);}
  h1{font-size:20px;font-weight:700;color:var(--accent);margin-bottom:4px;}
  .sub{font-size:13px;color:var(--dim);margin-bottom:24px;}
  .ep{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;}
  .ep-title{font-size:16px;font-weight:600;margin-bottom:4px;}
  .ep-date{font-size:12px;color:var(--dim);margin-bottom:14px;}
  audio{width:100%;accent-color:var(--accent);margin-bottom:10px;display:block;}
  .ep-dl{font-size:12px;color:var(--dim);text-decoration:none;}
  .ep-dl:hover{color:var(--accent);}
</style>
</head>
<body>
  <a class="back" href="/_/www.kingdomofloathing.com/game.php">&larr; back to the game</a>
  <h1>The KoL Show</h1>
  <p class="sub">Kingdom of Loathing podcast — streaming through the proxy</p>
  <div class="ep">
    <div class="ep-title">The KoL Show — August 6, 2026</div>
    <div class="ep-date">August 6, 2026</div>
    <audio controls preload="none" src="/_/shows.kingdomofloathing.com/The_KoL_Show_20260806.mp3"></audio>
    <a class="ep-dl" href="/_/shows.kingdomofloathing.com/The_KoL_Show_20260806.mp3" download="The_KoL_Show_20260806.mp3">⬇ download</a>
  </div>
</body>
</html>`;


// ── STANDALONE AUTO-ADVENTURE PAGE ────────────────────────────────────────────

const AUTO_ADVENTURE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Auto-adventure</title>
<style>
  :root {
    --bg: #14171c; --panel: #1b1f26; --line: #2a2f38;
    --text: #e6e9ef; --dim: #8b93a1; --accent: #6fce8f; --warn: #e0a84f; --err: #e0715f;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 -apple-system, system-ui, sans-serif; padding: 20px; max-width: 640px; margin: 0 auto; }
  h1 { font-size: 17px; font-weight: 600; margin: 0 0 16px; color: var(--dim); letter-spacing: 0.02em; }
  label { display: block; font-size: 13px; color: var(--dim); margin: 14px 0 6px; }
  input { width: 100%; background: var(--panel); border: 1px solid var(--line); color: var(--text); border-radius: 6px; padding: 10px 12px; font-size: 15px; }
  input:focus { outline: none; border-color: var(--accent); }
  .row { display: flex; gap: 12px; }
  .row > div { flex: 1; }
  button { margin-top: 18px; padding: 11px 18px; border-radius: 6px; border: none; font-size: 15px; font-weight: 600; cursor: pointer; }
  #start { background: var(--accent); color: #0d1f14; }
  #stop { background: var(--panel); color: var(--text); border: 1px solid var(--line); margin-left: 8px; }
  button:disabled { opacity: 0.4; cursor: default; }
  #status { margin-top: 16px; font-size: 13px; color: var(--dim); }
  #log { margin-top: 10px; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 12px; height: 260px; overflow-y: auto; font: 13px/1.6 ui-monospace, "SF Mono", monospace; white-space: pre-wrap; }
  .stopped { color: var(--warn); }
  .err { color: var(--err); }
  #back { display: inline-block; margin-top: 18px; color: var(--dim); font-size: 13px; text-decoration: none; }
</style>
</head>
<body>
  <h1>AUTO-ADVENTURE<\/h1>
  <label for="target">Adventure link<\/label>
  <input id="target" placeholder="paste the adventure.php link for the zone">
  <div class="row">
    <div><label for="turns">Turns<\/label><input id="turns" type="number" value="10" min="1"><\/div>
    <div><label for="macroId">Macro ID (optional)<\/label><input id="macroId" placeholder="only if fights don't auto-resolve"><\/div>
  <\/div>
  <button id="start">Start<\/button>
  <button id="stop" disabled>Stop<\/button>
  <div><a id="back" href="/_/www.kingdomofloathing.com/game.php">&larr; back to the game<\/a><\/div>
  <div id="status"><\/div>
  <div id="log"><\/div>
<script>
  let stopRequested = false;
  const logEl = document.getElementById('log');
  const statusEl = document.getElementById('status');
  const startBtn = document.getElementById('start');
  const stopBtn = document.getElementById('stop');
  function addLog(line, cls) {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = line;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }
  async function start() {
    const target = document.getElementById('target').value.trim();
    let turns = parseInt(document.getElementById('turns').value, 10);
    const macroId = document.getElementById('macroId').value.trim();
    if (!target || !turns) { addLog('Enter a link and a turn count first.', 'err'); return; }
    stopRequested = false; startBtn.disabled = true; stopBtn.disabled = false; logEl.innerHTML = '';
    addLog(\`Starting: \${turns} turns\`);
    let totalDone = 0;
    while (turns > 0 && !stopRequested) {
      const params = new URLSearchParams({ target, turns: String(turns) });
      if (macroId) params.set('macroId', macroId);
      let data;
      try {
        const res = await fetch('/auto-adventure/run?' + params.toString());
        const raw = await res.text();
        try { data = JSON.parse(raw); } catch { addLog(\`Error: unexpected response (HTTP \${res.status}): \${raw.slice(0, 200)}\`, 'err'); break; }
      } catch (e) { addLog(\`Error: \${e.message}\`, 'err'); break; }
      if (data.error) { addLog(\`Error: \${data.error}\`, 'err'); break; }
      data.log.forEach((line) => addLog(line));
      totalDone += data.completed; turns = data.remaining;
      statusEl.textContent = \`\${totalDone} done, \${turns} left\`;
      if (data.stopped) { addLog(\`Stopped: \${data.reason}\`, 'stopped'); break; }
    }
    if (stopRequested) addLog('Stopped by you.', 'stopped');
    else if (turns <= 0) addLog('Done.');
    startBtn.disabled = false; stopBtn.disabled = true;
  }
  startBtn.addEventListener('click', start);
  stopBtn.addEventListener('click', () => { stopRequested = true; });
<\/script>
</body>
</html>`;

// ── MAIN EXPORT ───────────────────────────────────────────────────────────────

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/auto-adventure") {
      return new Response(AUTO_ADVENTURE_HTML, { headers: { "content-type": "text/html;charset=UTF-8" } });
    }
    if (url.pathname === "/auto-adventure/run") {
      return runAutoAdventureBatch(request, url);
    }
    if (url.pathname === "/podcast") {
      return new Response(PODCAST_HTML, { headers: { "content-type": "text/html;charset=UTF-8" } });
    }
    const workerOrigin = url.origin;
    let targetHost, targetPath;
    const decoded = decodeProxyPath(url.pathname);
    if (decoded) { targetHost = decoded.host; targetPath = decoded.path; }
    else { targetHost = TARGET_HOST; targetPath = url.pathname; }

    if (!isAllowedHost(targetHost)) {
      return new Response("Host not allowed", { status: 403 });
    }

    const targetUrl = new URL(`https://${targetHost}${targetPath}${url.search}`);
    const outHeaders = stripHopHeaders(request.headers);
    outHeaders.set("Host", targetHost);
    outHeaders.set("Referer", targetUrl.toString());
    outHeaders.set("Origin", `https://${targetHost}`);
    outHeaders.delete("cf-connecting-ip");

    // Pass Range header through explicitly — stripHopHeaders doesn't remove it,
    // but being explicit ensures audio seeking and duration detection work.
    // The browser sends Range: bytes=0- on the first request to probe file length.
    const rangeHeader = request.headers.get("range");
    if (rangeHeader) outHeaders.set("range", rangeHeader);

    // FIX: removed duplex:"half" — not supported in Cloudflare Workers, causes 1101
    const init = { method: request.method, headers: outHeaders, redirect: "manual" };
    if (!["GET", "HEAD"].includes(request.method)) init.body = request.body;

    if (url.searchParams.get("raw") === "1") {
      const debugResp = await fetch(targetUrl.toString(), { ...init, redirect: "follow" });
      const text = await debugResp.text();
      return new Response(text, { status: debugResp.status, headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    const response = await fetch(targetUrl.toString(), init);

    if (response.webSocket) {
      return new Response(null, { status: 101, webSocket: response.webSocket });
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("Location");
      if (location) {
        const locUrl = new URL(location, targetUrl);
        const newHeaders = new Headers(response.headers);
        if (isAllowedHost(locUrl.hostname)) {
          newHeaders.set("Location", toProxyPath(workerOrigin, locUrl.hostname, locUrl.pathname + locUrl.search));
        }
        return new Response(response.body, { status: response.status, headers: newHeaders });
      }
    }

    const contentType = response.headers.get("content-type") || "";
    const isBinary = !contentType.includes("text/html") &&
                     !contentType.includes("javascript") &&
                     !contentType.includes("css") &&
                     !contentType.includes("json");

    const respHeaders = new Headers(response.headers);
    respHeaders.delete("x-frame-options");
    respHeaders.delete("content-security-policy");
    respHeaders.delete("content-security-policy-report-only");
    respHeaders.delete("cross-origin-opener-policy");
    respHeaders.delete("cross-origin-embedder-policy");
    respHeaders.delete("cross-origin-resource-policy");
    respHeaders.delete("content-encoding");
    // Keep content-length for binary files (audio needs it for duration/seeking).
    // Strip it for text responses since we rewrite them and the length changes.
    if (!isBinary) respHeaders.delete("content-length");
    respHeaders.set("access-control-allow-origin", "*");
    // Expose range-related headers so the browser audio player can use them
    respHeaders.set("access-control-expose-headers", "content-length, content-range, accept-ranges");

    const cookies =
      typeof response.headers.getAll === "function"
        ? response.headers.getAll("set-cookie")
        : response.headers.get("set-cookie") ? [response.headers.get("set-cookie")] : [];
    if (cookies.length) {
      respHeaders.delete("set-cookie");
      for (let cookie of cookies) {
        cookie = cookie.replace(/;\s*domain=[^;]*/gi, "");
        cookie = cookie.replace(/;\s*secure/gi, "");
        // FIX: SameSite=None not Lax — Lax blocks cross-origin subresource requests
        cookie = cookie.replace(/;\s*samesite=[^;]*/gi, "; SameSite=None");
        cookie = cookie.replace(/;\s*path=[^;]*/gi, "");
        cookie += "; Path=/";
        respHeaders.append("set-cookie", cookie);
      }
    }

    if (contentType.includes("text/html")) {
      const rewriter = new HTMLRewriter()
        .on("head", {
          element(el) {
            el.prepend(injectionScript(workerOrigin) + autoAdventurePanelScript(), { html: true });
          },
        })
        .on("a[href], link[href], area[href]", new AttrRewriter("href", workerOrigin))
        .on("img[src], script[src], iframe[src], source[src], audio[src], video[src], frame[src]", new AttrRewriter("src", workerOrigin))
        .on("form[action]", new AttrRewriter("action", workerOrigin))
        .on("img[srcset], source[srcset]", new SrcsetRewriter(workerOrigin))
        .on("base", new AttrRewriter("href", workerOrigin))
        .on('meta[http-equiv="refresh" i]', new MetaRefreshRewriter(workerOrigin))
        .on("script", new TextRewriter(workerOrigin))
        .on("style", new TextRewriter(workerOrigin));

      return rewriter.transform(new Response(response.body, { status: response.status, headers: respHeaders }));
    }

    if (contentType.includes("css") || contentType.includes("javascript") || contentType.includes("json")) {
      const text = rewriteTextContent(await response.text(), workerOrigin);
      return new Response(text, { status: response.status, headers: respHeaders });
    }

    // Audio and video: redirect directly to the real URL so the browser handles
    // range requests natively. Proxying binary through a Worker breaks seeking
    // and duration detection because Workers can't relay 206 Partial Content properly.
    if (contentType.includes("audio/") || contentType.includes("video/")) {
      return Response.redirect(targetUrl.toString(), 302);
    }

    return new Response(response.body, { status: response.status, headers: respHeaders });
  },
};
