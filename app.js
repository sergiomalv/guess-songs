"use strict";

/* =========================================================
   Comparación tolerante de respuestas
   ========================================================= */

// Palabras que no aportan nada al comparar ("La cabalgata de las valquirias" ≈ "cabalgata valquirias")
const STOPWORDS = new Set(["el", "la", "los", "las", "de", "del", "y", "en", "a", "l", "d", "the", "of", "n", "no", "num", "numero", "op"]);

function normalize(text) {
  return text
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[ºª]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(text) {
  return normalize(text).split(" ").filter(t => t && !STOPWORDS.has(t));
}

function levenshtein(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// Cuántas letras de error se permiten según la longitud
function tolerance(len) {
  if (len <= 3) return 0;
  if (len <= 5) return 1;
  if (len <= 10) return 2;
  return Math.floor(len * 0.2);
}

const digitsOf = s => (s.match(/\d+/g) || []).join(",");

// ¿Aparece `alias` (con pequeñas faltas) dentro del texto escrito?
function fuzzyContains(inputTokens, alias) {
  const at = tokens(alias);
  if (!at.length) return false;
  const target = at.join(" ");
  const tol = tolerance(target.length);
  for (let size = Math.max(1, at.length - 1); size <= at.length + 1; size++) {
    for (let i = 0; i + size <= inputTokens.length; i++) {
      const win = inputTokens.slice(i, i + size).join(" ");
      // Los números tienen que coincidir exactos (Sinfonía 5 ≠ Sinfonía 9)
      if (digitsOf(win) !== digitsOf(target)) continue;
      if (levenshtein(win, target) > tol) continue;
      // Y cada palabra importante debe parecerse por sí sola (Verano ≠ Otoño aunque compartan "cuatro estaciones")
      const wt = win.split(" ");
      if (at.every(a => a.length < 4 || wt.some(w => levenshtein(w, a) <= tolerance(a.length)))) return true;
    }
  }
  return false;
}

function grade(input, song) {
  const it = tokens(input);
  const obraOk = [song.obra, ...song.obraAlias].some(a => fuzzyContains(it, a));
  const autorOk = [song.autor, ...song.autorAlias].some(a => fuzzyContains(it, a));
  return { obraOk, autorOk, correct: obraOk && autorOk };
}

const labelOf = song => `${song.obra} — ${song.autor}`;

// Para tests en Node
if (typeof module !== "undefined") module.exports = { normalize, tokens, fuzzyContains, grade, labelOf };

/* =========================================================
   Juego (solo en el navegador)
   ========================================================= */

if (typeof window !== "undefined" && window.SONGS) (function () {
  const SONGS = window.SONGS;
  const STORE_KEY = "adivina-obra-v1";
  const WEIGHTS = [8, 4, 2, 1, 0.5]; // nivel 0 (fallada) … nivel 4 (dominada)
  const MASTER_LEVEL = 3;
  const isTouch = matchMedia("(pointer: coarse)").matches;

  const $ = id => document.getElementById(id);
  const el = {
    start: $("start"), btnStart: $("btn-start"), cover: $("cover"), coverText: $("cover-text"),
    play: $("btn-play"), back: $("btn-back"), fwd: $("btn-fwd"), seek: $("seek"), tCur: $("t-cur"), tDur: $("t-dur"),
    form: $("answer-form"), input: $("answer"), sugg: $("suggestions"), check: $("btn-check"), giveup: $("btn-giveup"),
    feedback: $("feedback"), next: $("btn-next"), video: $("btn-video"),
    sOk: $("s-ok"), sKo: $("s-ko"), sStreak: $("s-streak"), sMaster: $("s-master"), sTotal: $("s-total"),
    review: $("review-mode"), statsBody: $("stats-body"), reset: $("btn-reset"),
  };

  /* ---------- Progreso guardado ---------- */
  let store = load();
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || { songs: {}, review: true }; }
    catch { return { songs: {}, review: true }; }
  }
  function save() { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }
  function statOf(id) { return store.songs[id] || (store.songs[id] = { lvl: 1, ok: 0, fail: 0 }); }
  function record(song, ok) {
    const s = statOf(song.id);
    if (ok) { s.ok++; s.lvl = Math.min(WEIGHTS.length - 1, s.lvl + 1); }
    else { s.fail++; s.lvl = 0; }
    save();
    renderStats();
  }

  /* ---------- Estado de la ronda ---------- */
  const session = { ok: 0, ko: 0, streak: 0 };
  let current = null;
  let attempted = false;
  let resolved = false;
  const recent = [];

  function pickSong() {
    const pool = SONGS.filter(s => !recent.includes(s.id));
    const weights = pool.map(s => (store.review ? WEIGHTS[statOf(s.id).lvl] : 1));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) { if ((r -= weights[i]) < 0) return pool[i]; }
    return pool[pool.length - 1];
  }

  function newRound() {
    current = pickSong();
    recent.push(current.id);
    if (recent.length > 3) recent.shift();
    attempted = false;
    resolved = false;

    el.input.value = "";
    el.input.disabled = false;
    el.check.disabled = false;
    el.giveup.disabled = false;
    el.feedback.innerHTML = "";
    el.next.hidden = true;
    el.video.hidden = true;
    el.cover.classList.remove("hidden", "passthrough");
    el.coverText.textContent = "Escucha y adivina la obra y su autor";
    el.seek.value = 0;
    closeSuggestions();

    player.loadVideoById(current.id);
    if (!isTouch) el.input.focus();
  }

  function finishRound(html) {
    resolved = true;
    el.feedback.innerHTML = html + `<span class="answer-reveal">${escapeHtml(labelOf(current))}</span>`;
    el.input.disabled = true;
    el.check.disabled = true;
    el.giveup.disabled = true;
    el.next.hidden = false;
    el.video.hidden = false;
    el.video.textContent = "👁 Ver vídeo";
    closeSuggestions();
    renderSession();
    el.next.focus();
  }

  function check() {
    if (resolved || !current) return;
    const text = el.input.value.trim();
    if (!text) { el.input.focus(); return; }
    const g = grade(text, current);

    if (g.correct) {
      if (!attempted) { record(current, true); session.ok++; session.streak++; }
      finishRound(`<span class="good">${attempted ? "¡Correcto! (esta vez no cuenta como acierto)" : "¡Correcto! 🎉"}</span>`);
      return;
    }

    if (!attempted) { record(current, false); session.ko++; session.streak = 0; renderSession(); }
    attempted = true;
    const msg = g.obraOk ? "La obra es correcta, pero falta el autor o no es ese."
      : g.autorOk ? "El autor es correcto, pero la obra no."
      : "No es correcta.";
    el.feedback.innerHTML = `<span class="bad">${msg}</span> Prueba otra vez o pulsa «Me rindo».`;
    el.input.select();
  }

  function giveUp() {
    if (resolved || !current) return;
    if (!attempted) { record(current, false); session.ko++; session.streak = 0; }
    finishRound(`<span class="bad">La respuesta era:</span>`);
  }

  function renderSession() {
    el.sOk.textContent = session.ok;
    el.sKo.textContent = session.ko;
    el.sStreak.textContent = session.streak;
  }

  function renderStats() {
    el.sMaster.textContent = SONGS.filter(s => statOf(s.id).lvl >= MASTER_LEVEL).length;
    el.sTotal.textContent = SONGS.length;
    const rows = [...SONGS].sort((a, b) => {
      const sa = statOf(a.id), sb = statOf(b.id);
      return sa.lvl - sb.lvl || sb.fail - sa.fail || a.obra.localeCompare(b.obra);
    });
    el.statsBody.innerHTML = rows.map(s => {
      const st = statOf(s.id);
      const dots = "●".repeat(st.lvl) + "○".repeat(WEIGHTS.length - 1 - st.lvl);
      return `<tr><td>${escapeHtml(s.obra)}<small class="m-autor">${escapeHtml(s.autor)}</small></td><td>${escapeHtml(s.autor)}</td>` +
        `<td class="num">${st.ok}</td><td class="num">${st.fail}</td><td class="lvl" title="Nivel ${st.lvl}">${dots}</td></tr>`;
    }).join("");
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------- Desplegable de sugerencias ---------- */
  const options = SONGS.map(s => ({ label: labelOf(s), song: s, toks: tokens(labelOf(s)) }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
  let shown = [];
  let active = -1;

  function tokenMatches(q, labelToks) {
    return labelToks.some(t => t.includes(q) || (q.length >= 4 && levenshtein(t.slice(0, q.length), q) <= 1));
  }

  function openSuggestions() {
    const q = tokens(el.input.value);
    shown = options.filter(o => q.every(t => tokenMatches(t, o.toks)));
    active = -1;
    if (!shown.length || el.input.disabled) { closeSuggestions(); return; }
    el.sugg.innerHTML = shown.map((o, i) =>
      `<li role="option" data-i="${i}">${escapeHtml(o.song.obra)} <small>— ${escapeHtml(o.song.autor)}</small></li>`).join("");
    el.sugg.hidden = false;
  }

  function closeSuggestions() {
    el.sugg.hidden = true;
    shown = [];
    active = -1;
  }

  function setActive(i) {
    const items = el.sugg.children;
    if (!items.length) return;
    active = (i + items.length) % items.length;
    [...items].forEach((li, k) => li.classList.toggle("active", k === active));
    items[active].scrollIntoView({ block: "nearest" });
  }

  function choose(i) {
    el.input.value = shown[i].label;
    closeSuggestions();
    el.input.focus();
  }

  el.input.addEventListener("input", openSuggestions);
  el.input.addEventListener("click", openSuggestions);
  el.input.addEventListener("keydown", e => {
    if (el.sugg.hidden) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); choose(active); }
    else if (e.key === "Escape") { closeSuggestions(); }
  });
  // pointerdown en lugar de click para que el input no pierda el foco antes de elegir
  el.sugg.addEventListener("pointerdown", e => {
    const li = e.target.closest("li");
    if (!li) return;
    e.preventDefault();
    choose(Number(li.dataset.i));
  });
  document.addEventListener("pointerdown", e => {
    if (!e.target.closest(".combo")) closeSuggestions();
  });

  /* ---------- Botones ---------- */
  el.form.addEventListener("submit", e => { e.preventDefault(); check(); });
  el.giveup.addEventListener("click", giveUp);
  el.next.addEventListener("click", newRound);
  el.video.addEventListener("click", () => {
    const hide = !el.cover.classList.contains("hidden");
    el.cover.classList.toggle("hidden", hide);
    el.video.textContent = hide ? "🎵 Ocultar vídeo" : "👁 Ver vídeo";
  });
  el.review.checked = store.review !== false;
  el.review.addEventListener("change", () => { store.review = el.review.checked; save(); });
  el.reset.addEventListener("click", () => {
    if (!confirm("¿Seguro que quieres borrar todo el progreso?")) return;
    store.songs = {};
    save();
    renderStats();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Enter" && resolved && document.activeElement !== el.input) { e.preventDefault(); el.next.click(); }
  });

  /* ---------- Reproductor de YouTube ---------- */
  let player = null;
  let ready = false;
  let dragging = false;
  let playFallback = null;

  window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player("player", {
      playerVars: { controls: 0, disablekb: 1, fs: 0, rel: 0, iv_load_policy: 3, playsinline: 1, modestbranding: 1 },
      events: {
        onReady: () => {
          ready = true;
          el.btnStart.disabled = false;
          el.btnStart.textContent = "▶ Empezar";
        },
        onStateChange: onState,
        onError: e => {
          el.feedback.innerHTML = `<span class="bad">Este vídeo no se puede reproducir (error ${e.data}).</span> Pasa a la siguiente.`;
          el.next.hidden = false;
        },
      },
    });
  };

  function onState(e) {
    const playing = e.data === YT.PlayerState.PLAYING;
    el.play.textContent = playing ? "⏸" : "▶";
    el.cover.classList.toggle("playing", playing);
    if (playing || e.data === YT.PlayerState.BUFFERING) {
      clearTimeout(playFallback);
      el.cover.classList.remove("passthrough");
      el.coverText.textContent = "Escucha y adivina la obra y su autor";
    }
  }

  // En algunos móviles el navegador bloquea el play por API: dejamos tocar el reproductor "a través" de la carátula
  function armFallback() {
    clearTimeout(playFallback);
    playFallback = setTimeout(() => {
      const st = player.getPlayerState();
      if (st !== YT.PlayerState.PLAYING && st !== YT.PlayerState.BUFFERING) {
        el.cover.classList.add("passthrough");
        el.coverText.textContent = "Toca el disco para que empiece a sonar";
      }
    }, 2500);
  }

  el.btnStart.addEventListener("click", () => {
    if (!ready) return;
    el.start.hidden = true;
    newRound();
    armFallback();
  });
  el.next.addEventListener("click", armFallback);

  el.play.addEventListener("click", () => {
    if (!ready || !current) return;
    if (player.getPlayerState() === YT.PlayerState.PLAYING) player.pauseVideo();
    else { player.playVideo(); armFallback(); }
  });
  const skip = d => { if (ready && current) player.seekTo(Math.max(0, player.getCurrentTime() + d), true); };
  el.back.addEventListener("click", () => skip(-10));
  el.fwd.addEventListener("click", () => skip(10));

  el.seek.addEventListener("input", () => { dragging = true; el.tCur.textContent = fmt(+el.seek.value); });
  el.seek.addEventListener("change", () => {
    dragging = false;
    if (ready && current) player.seekTo(+el.seek.value, true);
  });

  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  setInterval(() => {
    if (!ready || !current || dragging) return;
    const dur = player.getDuration() || 0;
    const cur = player.getCurrentTime() || 0;
    el.seek.max = Math.floor(dur);
    el.seek.value = Math.floor(cur);
    el.tCur.textContent = fmt(cur);
    el.tDur.textContent = fmt(dur);
  }, 250);

  renderSession();
  renderStats();
})();
