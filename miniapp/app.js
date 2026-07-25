// ============================================================
//   BATTLE ARENA — Mini App
//   Telegram WebApp API bilan to'liq integratsiya:
//   ready/expand/requestFullscreen, HapticFeedback, MainButton,
//   theme params.
// ============================================================
'use strict';

const tg = window.Telegram ? window.Telegram.WebApp : null;

// ── TELEGRAM WEBAPP: boshlang'ich sozlash ──
if (tg) {
  tg.ready();
  tg.expand();
  if (typeof tg.requestFullscreen === 'function') {
    try { tg.requestFullscreen(); } catch (e) {}
  }
  if (typeof tg.disableVerticalSwipes === 'function') {
    try { tg.disableVerticalSwipes(); } catch (e) {}
  }
  // MUHIM: enableClosingConfirmation() ATAYLAB ishlatilmaydi — bu funksiya
  // yoqilganda Telegram HAR SAFAR ilova yopilganda "Changes that you made
  // may not be saved" degan native ogohlantirish chiqaradi, hatto hech
  // qanday to'ldirilmagan forma bo'lmasa ham. Bizning oqimda har bir
  // wizard qadami serverga darhol yuborilmaydi (faqat oxirida "Yaratish"
  // bosilganda), lekin bekor qilingan wizard hech narsani yo'qotmaydi —
  // shuning uchun bu ogohlantirish faqat keraksiz friksiya qo'shardi.
}

function haptic(kind) {
  if (!tg || !tg.HapticFeedback) return;
  if (['light', 'medium', 'heavy', 'rigid', 'soft'].includes(kind)) {
    tg.HapticFeedback.impactOccurred(kind);
  } else if (['success', 'error', 'warning'].includes(kind)) {
    tg.HapticFeedback.notificationOccurred(kind);
  } else if (kind === 'select') {
    tg.HapticFeedback.selectionChanged();
  }
}

// ============================================================
//   JONLI FON: canvas ustida suzuvchi yorug' zarralar + ular orasidagi
//   nozik "yulduz turkumi" chiziqlari (yaqin turgan zarralar bir-biriga
//   yupqa chiziq bilan bog'lanadi) — bu fonni sezilarli darajada
//   "jonli" va premium ko'rinishga olib keladi.
// ============================================================
(function initBgCanvas() {
  const canvas = document.getElementById('bg-canvas');
  const c = canvas.getContext('2d');
  let w, h, particles, nebulae, t = 0;
  const COLORS = ['#a259ff', '#ff3ea5', '#3ee8ff', '#39ff88', '#ff8a3d'];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LINK_DIST = 128;

  function resize() { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; }

  function makeParticles() {
    const count = Math.min(74, Math.max(30, Math.floor((w * h) / 16000)));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      r: 1.1 + Math.random() * 2.7,
      vx: (Math.random() - 0.5) * 0.96, vy: (Math.random() - 0.5) * 0.96,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      alpha: 0.3 + Math.random() * 0.45
    }));
    // Nebula — sekin aylanuvchi, yumshoq halqa shakllar (2-chi harakat qatlami)
    nebulae = Array.from({ length: 3 }, (_, i) => ({
      cx: w * (0.2 + Math.random() * 0.6), cy: h * (0.2 + Math.random() * 0.6),
      r: Math.min(w, h) * (0.16 + Math.random() * 0.1),
      color: COLORS[(i * 2) % COLORS.length],
      speed: (0.36 + Math.random() * 0.29) * (i % 2 === 0 ? 1 : -1)
    }));
  }

  function tick() {
    c.clearRect(0, 0, w, h);

    for (const n of nebulae) {
      c.save();
      c.translate(n.cx, n.cy);
      c.rotate(t * n.speed * 0.01);
      c.beginPath();
      c.arc(0, 0, n.r, 0, Math.PI * 1.5);
      c.strokeStyle = n.color;
      c.globalAlpha = 0.09;
      c.lineWidth = 22;
      c.shadowColor = n.color;
      c.shadowBlur = 30;
      c.stroke();
      c.restore();
    }
    c.globalAlpha = 1;

    // Yaqin zarralarni yupqa chiziq bilan bog'lash (constellation effekti)
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i], b = particles[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < LINK_DIST) {
          c.beginPath();
          c.moveTo(a.x, a.y);
          c.lineTo(b.x, b.y);
          c.strokeStyle = `rgba(180, 150, 255, ${0.16 * (1 - dist / LINK_DIST)})`;
          c.lineWidth = 1;
          c.stroke();
        }
      }
    }

    for (const p of particles) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < -10) p.x = w + 10; if (p.x > w + 10) p.x = -10;
      if (p.y < -10) p.y = h + 10; if (p.y > h + 10) p.y = -10;
      c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      c.fillStyle = p.color; c.globalAlpha = p.alpha;
      c.shadowColor = p.color; c.shadowBlur = 12;
      c.fill();
    }
    c.globalAlpha = 1;
    t += 1;
    if (!reduceMotion) requestAnimationFrame(tick);
  }

  resize(); makeParticles();
  window.addEventListener('resize', () => { resize(); makeParticles(); });
  tick();
})();

// ============================================================
//   CAPTCHA "SHIELD ORB" ANIMATSIYASI — kichik canvas ustida
//   aylanuvchi himoya halqalari + orbital zarrachalar (video-klipga
//   o'xshash jonli harakat, captcha ekranini premium qiladi).
// ============================================================
(function initCaptchaOrb() {
  const canvas = document.getElementById('captcha-orb');
  if (!canvas) return;
  const c = canvas.getContext('2d');
  const SIZE = 132;
  canvas.width = SIZE; canvas.height = SIZE;
  const cx = SIZE / 2, cy = SIZE / 2;
  let t = 0;
  let raf = null;

  const orbiters = Array.from({ length: 3 }, (_, i) => ({
    radius: 38 + i * 15,
    speed: (i % 2 === 0 ? 1 : -1) * (0.012 + i * 0.004),
    offset: (Math.PI * 2 / 3) * i,
    color: ['#a259ff', '#3ee8ff', '#ff3ea5'][i],
    size: 3.2 - i * 0.4
  }));

  function draw() {
    c.clearRect(0, 0, SIZE, SIZE);

    // Orqa fon halqalari (statik, yumshoq)
    for (let ring = 1; ring <= 2; ring++) {
      c.beginPath();
      c.arc(cx, cy, 30 + ring * 20, 0, Math.PI * 2);
      c.strokeStyle = `rgba(162, 89, 255, ${0.12 / ring})`;
      c.lineWidth = 1;
      c.stroke();
    }

    // Orbital zarralar + iz (trail)
    orbiters.forEach(o => {
      const angle = t * o.speed + o.offset;
      const x = cx + Math.cos(angle) * o.radius;
      const y = cy + Math.sin(angle) * o.radius;

      // iz
      const trailAngle = angle - o.speed * 6;
      const tx = cx + Math.cos(trailAngle) * o.radius;
      const ty = cy + Math.sin(trailAngle) * o.radius;
      const grad = c.createLinearGradient(tx, ty, x, y);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(1, o.color);
      c.beginPath();
      c.moveTo(tx, ty);
      c.lineTo(x, y);
      c.strokeStyle = grad;
      c.lineWidth = 2;
      c.stroke();

      // zarra
      c.beginPath();
      c.arc(x, y, o.size, 0, Math.PI * 2);
      c.fillStyle = o.color;
      c.shadowColor = o.color;
      c.shadowBlur = 10;
      c.fill();
    });

    t += 1;
    raf = requestAnimationFrame(draw);
  }

  // Faqat captcha view aktiv bo'lganda ishlaydi (batareya tejash uchun)
  window.__startCaptchaOrb = () => { if (!raf) draw(); };
  window.__stopCaptchaOrb = () => { if (raf) { cancelAnimationFrame(raf); raf = null; } };
})();

// ============================================================
//   API HELPER
// ============================================================
function getInitData() {
  // Har safar YANGI o'qiladi — bir martalik const emas. Ba'zi WebView
  // versiyalarida tg.initData skript ishga tushgan zahoti emas, bir necha
  // millisoniyadan keyin to'ladi; buni const qilib olib qo'yish butun
  // sessiya davomida bo'sh initData yuborishga (va shu sabab har doim
  // 401/"ma'lumot yuklanmadi" xatosiga) olib kelishi mumkin edi.
  return tg ? (tg.initData || '') : '';
}

function getSessionToken() {
  return localStorage.getItem('bt_session') || '';
}
function setSessionToken(token) {
  if (token) localStorage.setItem('bt_session', token);
  else localStorage.removeItem('bt_session');
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const initData = getInitData();
  // Telegram ichida bo'lsak initData bilan, aks holda (brauzer) Login
  // Widget orqali olingan sessiya tokeni bilan autentifikatsiya qilamiz.
  if (initData) headers['X-Telegram-Init-Data'] = initData;
  else if (getSessionToken()) headers['X-Session-Token'] = getSessionToken();

  const res = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'unknown' }));
    const e = new Error(err.error || 'request_failed');
    e.payload = err;
    e.status = res.status;
    throw e;
  }
  return res.json();
}

// ============================================================
//   UI YORDAMCHILARI
// ============================================================
function toast(message, kind) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = 'toast show' + (kind ? ' ' + kind : '');
  haptic(kind === 'error' ? 'error' : kind === 'success' ? 'success' : 'light');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.classList.remove('show'); }, 2600);
}

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  SoundEngine.whoosh();
}

function attachRipple(btn) {
  btn.addEventListener('pointerdown', (e) => {
    const rect = btn.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    const size = Math.max(rect.width, rect.height) * 1.2;
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
    ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  });
}

function wireInteractive(el, { sound = 'tap', hapticKind = 'light' } = {}) {
  if (el.classList.contains('btn')) attachRipple(el);
  el.addEventListener('click', () => {
    (SoundEngine[sound] || SoundEngine.tap)();
    haptic(hapticKind);
  }, { capture: true });
}

document.addEventListener('pointerdown', () => SoundEngine.unlock(), { once: true });

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// ============================================================
//   MAIN BUTTON YORDAMCHISI
// ============================================================
function setMainButton({ text, onClick, show = true }) {
  if (!tg || !tg.MainButton) return;
  tg.MainButton.setText(text);
  if (setMainButton._lastHandler) tg.MainButton.offClick(setMainButton._lastHandler);
  const handler = () => { haptic('medium'); onClick(); };
  setMainButton._lastHandler = handler;
  tg.MainButton.onClick(handler);
  if (show) tg.MainButton.show(); else tg.MainButton.hide();
}
function hideMainButton() { if (tg && tg.MainButton) tg.MainButton.hide(); }

// ============================================================
//   MINI APP CAPTCHA — birinchi kirishda majburiy.
//   Oqim: captcha (agar o'tilmagan bo'lsa) → majburiy obuna → home.
// ============================================================
let ME = null;
let blockedTimerInterval = null;

async function checkGateAndInit() {
  try {
    ME = await api('/api/me');
  } catch (e) {
    const code = e.payload && e.payload.error;
    if (code === 'invalid_init_data') {
      const insideTelegram = !!(tg && tg.initData);
      if (insideTelegram) {
        // Telegram ICHIDA turib ham tasdiqlanmadi — bu odatda server
        // tomonidagi BOT_TOKEN muammosi, foydalanuvchi buni tuzata olmaydi.
        renderFatalError(
          'Autentifikatsiya xatosi',
          'Serverda vaqtinchalik muammo. Iltimos, birozdan so\'ng qayta urinib ko\'ring yoki admin bilan bog\'laning.'
        );
      } else {
        // Brauzerda ochilgan (Telegram tashqarisida) — haqiqiy Telegram
        // akkaunti bilan kirish uchun rasmiy Login Widget ko'rsatamiz.
        await renderLoginWidget();
      }
    } else {
      renderFatalError(
        'Ma\'lumot yuklanmadi',
        code ? `Xato: ${code}` : 'Server bilan bog\'lanib bo\'lmadi. Internetni tekshirib qayta urinib ko\'ring.'
      );
    }
    return;
  }

  const captcha = ME.captcha;

  if (captcha.state === 'blocked') {
    showBlockedView(captcha.blockedUntil);
    return;
  }

  if (captcha.state === 'pending') {
    await startCaptchaFlow();
    return;
  }

  continueAfterCaptcha();
}

// ============================================================
//   BRAUZERDA KIRISH — Telegram Login Widget
//   Mini App Telegram tashqarisida (oddiy brauzerda) ochilganda
//   ishlatiladi. Foydalanuvchi haqiqiy Telegram akkaunti bilan
//   tasdiqlanadi (server buni HMAC orqali tekshiradi) — shundan
//   keyin botdagi bilan bir xil: captcha, majburiy obuna, battle
//   yaratish — barchasi to'liq ishlaydi.
// ============================================================
async function renderLoginWidget() {
  hideSplash();
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="fatal-error login-screen">
      <div class="fatal-error-icon">🌐</div>
      <div class="fatal-error-title">Telegram orqali kiring</div>
      <div class="fatal-error-msg">Botdan foydalanish uchun haqiqiy Telegram akkauntingiz bilan tasdiqlaning.</div>
      <div id="login-widget-slot"></div>
    </div>`;

  let botUsername = '';
  try {
    const cfg = await fetch('/api/config').then(r => r.json());
    botUsername = cfg.botUsername || '';
  } catch (e) {}

  if (!botUsername) {
    document.getElementById('login-widget-slot').innerHTML =
      '<div class="fatal-error-msg">Login xizmati vaqtincha mavjud emas. Qayta urinib ko\'ring.</div>';
    return;
  }

  window.__onTelegramAuth = async (userData) => {
    try {
      const result = await fetch('/api/auth/telegram-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userData)
      }).then(r => r.ok ? r.json() : Promise.reject(r));
      setSessionToken(result.sessionToken);
      location.reload();
    } catch (e) {
      toast('Kirishda xato yuz berdi, qayta urinib ko\'ring', 'error');
    }
  };

  const script = document.createElement('script');
  script.src = 'https://telegram.org/js/telegram-widget.js?22';
  script.async = true;
  script.setAttribute('data-telegram-login', botUsername);
  script.setAttribute('data-size', 'large');
  script.setAttribute('data-radius', '14');
  script.setAttribute('data-onauth', '__onTelegramAuth(user)');
  script.setAttribute('data-request-access', 'write');
  document.getElementById('login-widget-slot').appendChild(script);
}

function renderFatalError(title, message) {
  hideSplash();
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="fatal-error">
      <div class="fatal-error-icon">⚠️</div>
      <div class="fatal-error-title">${escapeHtml(title)}</div>
      <div class="fatal-error-msg">${escapeHtml(message)}</div>
      <button class="btn btn-primary" id="fatal-retry">🔄 Qayta urinish</button>
    </div>`;
  document.getElementById('fatal-retry').addEventListener('click', () => {
    haptic('light');
    location.reload();
  });
}

function continueAfterCaptcha() {
  if (ME.subscription.required && !ME.subscription.ok) {
    renderGate(ME.subscription.channels);
    showView('view-gate');
    hideMainButton();
    return;
  }
  initHome();
}

// ── CAPTCHA OQIMI ──
async function startCaptchaFlow() {
  showView('view-captcha');
  hideMainButton();
  if (window.__startCaptchaOrb) window.__startCaptchaOrb();
  await loadCaptchaQuestion();
}

async function loadCaptchaQuestion() {
  try {
    const q = await api('/api/captcha/question');
    if (q.verified) { continueAfterCaptcha(); return; }

    document.getElementById('captcha-question').textContent = `${q.question} = ?`;
    renderCaptchaOptions(q.options);
    updateAttemptsLabel(q.attemptsLeft);
  } catch (e) {
    toast('Savol yuklanmadi', 'error');
  }
}

function updateAttemptsLabel(attemptsLeft) {
  const el = document.getElementById('captcha-attempts');
  const cfg = attemptsLeft;
  el.textContent = `Qolgan urinishlar: ${cfg}`;
  el.classList.toggle('danger', cfg <= 2);
}

function renderCaptchaOptions(options) {
  const wrap = document.getElementById('captcha-options');
  wrap.innerHTML = options.map(o => `<button class="captcha-option-btn" data-v="${o}">${o}</button>`).join('');
  wrap.querySelectorAll('.captcha-option-btn').forEach(btn => {
    wireInteractive(btn, { hapticKind: 'select' });
    btn.addEventListener('click', () => submitCaptchaAnswer(btn, Number(btn.dataset.v)));
  });
}

async function submitCaptchaAnswer(btnEl, answer) {
  document.querySelectorAll('.captcha-option-btn').forEach(b => b.disabled = true);

  try {
    const result = await api('/api/captcha/verify', { method: 'POST', body: { answer } });
    if (result.ok) {
      btnEl.classList.add('correct');
      haptic('success'); SoundEngine.success();
      if (window.__stopCaptchaOrb) window.__stopCaptchaOrb();
      setTimeout(() => {
        toast('Tasdiqlandi! Xush kelibsiz 🎉', 'success');
        continueAfterCaptcha();
      }, 550);
    }
  } catch (e) {
    const payload = e.payload || {};
    if (payload.error === 'captcha_blocked') {
      haptic('error'); SoundEngine.error();
      showBlockedView(payload.blockedUntil);
      return;
    }
    if (payload.error === 'captcha_expired') {
      toast('Savol muddati tugadi, yangisi yuklanmoqda', 'error');
      await loadCaptchaQuestion();
      document.querySelectorAll('.captcha-option-btn').forEach(b => b.disabled = false);
      return;
    }

    // Noto'g'ri javob
    btnEl.classList.add('wrong');
    haptic('error'); SoundEngine.error();
    updateAttemptsLabel(payload.attemptsLeft ?? 0);
    setTimeout(async () => {
      await loadCaptchaQuestion();
      document.querySelectorAll('.captcha-option-btn').forEach(b => b.disabled = false);
    }, 650);
  }
}

// ── BLOKLANGAN HOLAT (countdown) ──
function showBlockedView(blockedUntilMs) {
  showView('view-blocked');
  hideMainButton();
  if (window.__stopCaptchaOrb) window.__stopCaptchaOrb();

  clearInterval(blockedTimerInterval);
  const timerEl = document.getElementById('blocked-timer');

  function tick() {
    const remaining = blockedUntilMs - Date.now();
    if (remaining <= 0) {
      clearInterval(blockedTimerInterval);
      timerEl.textContent = '00:00';
      checkGateAndInit(); // blok tugagach avtomatik qaytadan tekshiramiz
      return;
    }
    const totalSec = Math.ceil(remaining / 1000);
    const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const ss = String(totalSec % 60).padStart(2, '0');
    timerEl.textContent = `${mm}:${ss}`;
  }
  tick();
  blockedTimerInterval = setInterval(tick, 1000);
}

// ============================================================
//   MAJBURIY OBUNA (GATE)
// ============================================================

function renderGate(channels) {
  const wrap = document.getElementById('gate-channels');
  wrap.innerHTML = channels.map(ch => `
    <a class="gate-channel-row" href="https://t.me/${ch.replace('@', '')}" target="_blank" data-ch="${ch}">
      <span>📢 ${escapeHtml(ch)}</span>
      <span class="go">Obuna bo'lish →</span>
    </a>
  `).join('');
  wrap.querySelectorAll('.gate-channel-row').forEach(row => wireInteractive(row, { hapticKind: 'select' }));
}

document.getElementById('gate-check').addEventListener('click', async () => {
  const btn = document.getElementById('gate-check');
  btn.disabled = true; btn.textContent = 'Tekshirilmoqda...';
  try {
    const r = await api('/api/check-subscription');
    if (r.ok) {
      haptic('success'); SoundEngine.success();
      toast('Obuna tasdiqlandi!', 'success');
      initHome();
    } else {
      haptic('error'); SoundEngine.error();
      toast('Hali barcha kanallarga obuna bo\'lmadingiz', 'error');
    }
  } catch (e) {
    toast('Tekshirib bo\'lmadi', 'error');
  }
  btn.disabled = false; btn.textContent = '✅ Tekshirish';
});
wireInteractive(document.getElementById('gate-check'), { sound: 'primary', hapticKind: 'medium' });

// ============================================================
//   HOME EKRANI
// ============================================================
function initHome() {
  showView('view-home');
  document.getElementById('user-name').textContent = ME.firstName || 'Foydalanuvchi';
  document.getElementById('stat-battles').textContent = ME.stats.createdBattles;

  if (ME.templates.length > 0) {
    const block = document.getElementById('templates-block');
    block.hidden = false;
    const scroll = document.getElementById('template-scroll');
    scroll.innerHTML = ME.templates.map(t =>
      `<button class="template-chip" data-tpl="${t.id}" data-type="${t.type}">🗂 ${escapeHtml(t.name)}</button>`
    ).join('');
    scroll.querySelectorAll('.template-chip').forEach(chip => {
      wireInteractive(chip, { hapticKind: 'select' });
      chip.addEventListener('click', () => startWizard(chip.dataset.type, chip.dataset.tpl));
    });
  }

  loadMineTab();
}

let currentTab = 'battle';
let mineCache = null;

document.querySelectorAll('.tab-btn').forEach(btn => {
  wireInteractive(btn, { hapticKind: 'select' });
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTab = btn.dataset.tab;
    renderMineList();
  });
});

async function loadMineTab() {
  try {
    mineCache = await api('/api/mine');
    renderMineList();
  } catch (e) {
    document.getElementById('battle-list').innerHTML =
      `<div class="empty-state"><div class="empty-emoji">⚠️</div><div class="empty-text">Yuklab bo'lmadi</div></div>`;
  }
}

function renderMineList() {
  const list = document.getElementById('battle-list');
  if (!mineCache) return;
  const key = currentTab === 'battle' ? 'battles' : currentTab === 'random' ? 'contests' : 'likebatls';
  const items = mineCache[key] || [];

  if (items.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-emoji">✨</div><div class="empty-text">Hali yaratmadingiz</div></div>`;
    return;
  }

  list.innerHTML = items.map(b => `
    <div class="battle-row">
      <div class="battle-row-dot ${b.active ? 'on' : 'off'}"></div>
      <div class="battle-row-body">
        <div class="battle-row-title">${escapeHtml(b.text || 'Sir 🤫')}</div>
        <div class="battle-row-meta">${escapeHtml(b.channel)} · ${b.participants} ishtirokchi</div>
      </div>
      <div class="battle-row-count">${b.count}</div>
    </div>
  `).join('');
}

document.getElementById('refresh-battles').addEventListener('click', async (e) => {
  e.currentTarget.classList.add('spinning');
  haptic('light'); SoundEngine.tap();
  await loadMineTab();
  setTimeout(() => e.currentTarget.classList.remove('spinning'), 620);
});

// ============================================================
//   WIZARD — 3 turdagi yaratish oqimi: battle / random / like
// ============================================================
let wizardState = {};

const WIZARD_STEPS = {
  battle: ['text', 'target', 'time', 'channel'],
  random: ['text', 'wincount', 'target', 'time', 'channel'],
  like:   ['points', 'time', 'channel']
};

function startWizard(mode, templateId) {
  wizardState = { mode, step: 0, saveAsTemplate: false };

  if (templateId && ME) {
    const tpl = ME.templates.find(t => t.id === templateId);
    if (tpl) {
      wizardState.text = tpl.text;
      wizardState.target = tpl.target;
      wizardState.winCount = tpl.winCount;
    }
  }

  document.getElementById('wizard-title').textContent =
    mode === 'battle' ? 'Ovoz Battle' : mode === 'random' ? 'Random Konkurs' : 'Like Battle';

  showView('view-create');
  renderWizardStep();
}

function renderWizardDots() {
  const steps = WIZARD_STEPS[wizardState.mode];
  const dots = document.getElementById('wizard-dots');
  dots.innerHTML = steps.map((_, i) =>
    `<span class="${i < wizardState.step ? 'done' : i === wizardState.step ? 'active' : ''}"></span>`
  ).join('');
}

function wizardNext() { wizardState.step++; renderWizardStep(); }

function renderWizardStep() {
  renderWizardDots();
  const body = document.getElementById('wizard-body');
  const step = WIZARD_STEPS[wizardState.mode][wizardState.step];

  if (step === 'text') {
    body.innerHTML = `
      <div>
        <label class="field-label">${wizardState.mode === 'battle' ? 'Sovrin / battle matni' : 'Konkurs matni'}</label>
        <textarea class="textarea" id="wz-text" placeholder="${wizardState.mode === 'battle' ? 'Masalan: 🥇 Top 1 ga 50 000 so\'m' : 'Masalan: Eng faol 3 kishiga sovg\'a!'}" maxlength="300">${wizardState.text || ''}</textarea>
        ${wizardState.mode === 'battle' ? '<div class="field-hint">Sovrinni sir saqlamoqchi bo\'lsangiz, bo\'sh qoldiring.</div>' : ''}
      </div>
      <div class="wizard-footer"><button class="btn btn-primary btn-block" id="wz-next">Davom etish →</button></div>`;
    wireInteractive(document.getElementById('wz-next'));
    document.getElementById('wz-next').addEventListener('click', () => {
      wizardState.text = document.getElementById('wz-text').value.trim();
      wizardNext();
    });
    return;
  }

  if (step === 'wincount') {
    const options = [1, 2, 3, 5, 10];
    body.innerHTML = `
      <div>
        <label class="field-label">Nechta g'olib bo'lsin?</label>
        <div class="chip-row" id="wz-win-chips">
          ${options.map(v => `<button class="chip-option ${wizardState.winCount === v ? 'selected' : ''}" data-v="${v}">${v}</button>`).join('')}
        </div>
      </div>
      <div class="wizard-footer"><button class="btn btn-primary btn-block" id="wz-next">Davom etish →</button></div>`;
    body.querySelectorAll('#wz-win-chips .chip-option').forEach(chip => {
      wireInteractive(chip, { hapticKind: 'select' });
      chip.addEventListener('click', () => {
        wizardState.winCount = Number(chip.dataset.v);
        body.querySelectorAll('.chip-option').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
      });
    });
    wireInteractive(document.getElementById('wz-next'));
    document.getElementById('wz-next').addEventListener('click', () => {
      if (!wizardState.winCount) wizardState.winCount = 1;
      wizardNext();
    });
    return;
  }

  if (step === 'target') {
    const label = wizardState.mode === 'battle' ? 'nechta ovozda g\'olib e\'lon qilinsin?' : 'nechta qatnashchida avto-yakunlansin?';
    const options = [0, 25, 50, 100, 200];
    body.innerHTML = `
      <div>
        <label class="field-label">Maqsad — ${label}</label>
        <div class="chip-row" id="wz-target-chips">
          ${options.map(v => `<button class="chip-option ${wizardState.target === v ? 'selected' : ''}" data-v="${v}">${v === 0 ? 'Faqat vaqt bilan' : v}</button>`).join('')}
        </div>
        <input class="input" id="wz-target-custom" type="number" inputmode="numeric" placeholder="O'zingiz kiriting" style="margin-top:10px" />
      </div>
      <div class="wizard-footer"><button class="btn btn-primary btn-block" id="wz-next">Davom etish →</button></div>`;
    body.querySelectorAll('#wz-target-chips .chip-option').forEach(chip => {
      wireInteractive(chip, { hapticKind: 'select' });
      chip.addEventListener('click', () => {
        wizardState.target = Number(chip.dataset.v);
        document.getElementById('wz-target-custom').value = '';
        body.querySelectorAll('.chip-option').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
      });
    });
    document.getElementById('wz-target-custom').addEventListener('input', (e) => {
      if (e.target.value) { wizardState.target = Number(e.target.value); body.querySelectorAll('.chip-option').forEach(c => c.classList.remove('selected')); }
    });
    wireInteractive(document.getElementById('wz-next'));
    document.getElementById('wz-next').addEventListener('click', wizardNext);
    return;
  }

  if (step === 'points') {
    body.innerHTML = `
      <div>
        <label class="field-label">❤️ Reaksiya uchun ball</label>
        <input class="input" id="wz-p-reaction" type="number" inputmode="numeric" value="${wizardState.pointsPerReaction ?? 1}" />
      </div>
      <div>
        <label class="field-label">⭐ 1 Stars uchun ball</label>
        <input class="input" id="wz-p-stars" type="number" inputmode="numeric" value="${wizardState.pointsPerStars ?? 5}" />
        <div class="field-hint">Ishtirokchilar ⭐ Stars'ni kanaldagi native reaction orqali yuboradi.</div>
      </div>
      <div>
        <label class="field-label">💬 Comment uchun ball</label>
        <input class="input" id="wz-p-comment" type="number" inputmode="numeric" value="${wizardState.pointsPerComment ?? 2}" />
      </div>
      <div class="wizard-footer"><button class="btn btn-primary btn-block" id="wz-next">Davom etish →</button></div>`;
    wireInteractive(document.getElementById('wz-next'));
    document.getElementById('wz-next').addEventListener('click', () => {
      wizardState.pointsPerReaction = Number(document.getElementById('wz-p-reaction').value) || 0;
      wizardState.pointsPerStars = Number(document.getElementById('wz-p-stars').value) || 0;
      wizardState.pointsPerComment = Number(document.getElementById('wz-p-comment').value) || 0;
      wizardNext();
    });
    return;
  }

  if (step === 'time') {
    body.innerHTML = `
      <div class="switch-row" id="wz-time-switch">
        <span class="switch-label">Tugash vaqtini belgilash</span>
        <div class="switch-track ${wizardState.useEndTime ? 'on' : ''}" id="wz-switch-track"><div class="switch-thumb"></div></div>
      </div>
      <div id="wz-time-field" style="${wizardState.useEndTime ? '' : 'display:none'}">
        <label class="field-label">Necha soatdan keyin tugasin?</label>
        <div class="chip-row" id="wz-hours-chips">
          ${[1, 6, 12, 24, 72].map(h => `<button class="chip-option ${wizardState.hours === h ? 'selected' : ''}" data-h="${h}">${h < 24 ? h + ' soat' : (h / 24) + ' kun'}</button>`).join('')}
        </div>
      </div>
      <div class="wizard-footer"><button class="btn btn-primary btn-block" id="wz-next">Davom etish →</button></div>`;
    const track = document.getElementById('wz-switch-track');
    wireInteractive(track, { hapticKind: 'select' });
    track.addEventListener('click', () => {
      wizardState.useEndTime = !wizardState.useEndTime;
      track.classList.toggle('on', wizardState.useEndTime);
      document.getElementById('wz-time-field').style.display = wizardState.useEndTime ? '' : 'none';
    });
    body.querySelectorAll('#wz-hours-chips .chip-option').forEach(chip => {
      wireInteractive(chip, { hapticKind: 'select' });
      chip.addEventListener('click', () => {
        wizardState.hours = Number(chip.dataset.h);
        body.querySelectorAll('#wz-hours-chips .chip-option').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
      });
    });
    wireInteractive(document.getElementById('wz-next'));
    document.getElementById('wz-next').addEventListener('click', wizardNext);
    return;
  }

  if (step === 'channel') {
    const showTemplate = wizardState.mode !== 'like';
    body.innerHTML = `
      <div>
        <label class="field-label">Kanal username</label>
        <input class="input" id="wz-channel" placeholder="@mychannel" autocapitalize="none" autocorrect="off" />
        <div class="field-hint">Bot va siz shu kanalda admin bo'lishingiz kerak.</div>
      </div>
      ${showTemplate ? `
      <div class="switch-row">
        <span class="switch-label">Shablon sifatida saqlash</span>
        <div class="switch-track ${wizardState.saveAsTemplate ? 'on' : ''}" id="wz-tpl-track"><div class="switch-thumb"></div></div>
      </div>
      <div id="wz-tpl-name-field" style="${wizardState.saveAsTemplate ? '' : 'display:none'}">
        <input class="input" id="wz-tpl-name" placeholder="Shablon nomi" maxlength="40" />
      </div>` : ''}
      <div class="wizard-footer"><button class="btn btn-success btn-block" id="wz-submit">🚀 Yaratish va yuborish</button></div>`;

    if (showTemplate) {
      const tplTrack = document.getElementById('wz-tpl-track');
      wireInteractive(tplTrack, { hapticKind: 'select' });
      tplTrack.addEventListener('click', () => {
        wizardState.saveAsTemplate = !wizardState.saveAsTemplate;
        tplTrack.classList.toggle('on', wizardState.saveAsTemplate);
        document.getElementById('wz-tpl-name-field').style.display = wizardState.saveAsTemplate ? '' : 'none';
      });
    }

    wireInteractive(document.getElementById('wz-submit'), { sound: 'primary', hapticKind: 'medium' });
    document.getElementById('wz-submit').addEventListener('click', submitWizard);
    return;
  }
}

document.getElementById('wizard-back').addEventListener('click', () => {
  haptic('light'); SoundEngine.tap();
  if (wizardState.step > 0) { wizardState.step--; renderWizardStep(); }
  else { showView('view-home'); }
});
wireInteractive(document.getElementById('wizard-back'));

async function submitWizard() {
  const channelInput = document.getElementById('wz-channel').value.trim();
  if (!channelInput) { toast('Kanal kiriting', 'error'); haptic('error'); return; }
  const channel = channelInput.startsWith('@') ? channelInput : '@' + channelInput;

  const submitBtn = document.getElementById('wz-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Tekshirilmoqda...';

  try {
    const verify = await api('/api/verify-channel', { method: 'POST', body: { channel } });
    submitBtn.textContent = 'Yaratilmoqda...';

    const endAt = wizardState.useEndTime && wizardState.hours ? Date.now() + wizardState.hours * 3600 * 1000 : null;

    if (wizardState.mode === 'battle') {
      const templateName = wizardState.saveAsTemplate ? (document.getElementById('wz-tpl-name').value.trim() || 'Nomsiz shablon') : null;
      await api('/api/battle/create', {
        method: 'POST',
        body: { text: wizardState.text || '', target: wizardState.target || 0, endAt, channel, chatId: verify.chatId, saveAsTemplate: wizardState.saveAsTemplate, templateName }
      });
    } else if (wizardState.mode === 'random') {
      const templateName = wizardState.saveAsTemplate ? (document.getElementById('wz-tpl-name').value.trim() || 'Nomsiz shablon') : null;
      await api('/api/contest/create', {
        method: 'POST',
        body: { text: wizardState.text || '', winCount: wizardState.winCount || 1, targetParticipants: wizardState.target || 0, endAt, channel, chatId: verify.chatId, saveAsTemplate: wizardState.saveAsTemplate, templateName }
      });
    } else {
      await api('/api/likebatl/create', {
        method: 'POST',
        body: { pointsPerReaction: wizardState.pointsPerReaction ?? 1, pointsPerStars: wizardState.pointsPerStars ?? 5, pointsPerComment: wizardState.pointsPerComment ?? 2, endAt, channel, chatId: verify.chatId }
      });
    }

    haptic('success'); SoundEngine.success();
    document.getElementById('success-sub').textContent = `${verify.title || channel} kanaliga muvaffaqiyatli yuborildi.`;
    showView('view-success');
  } catch (e) {
    haptic('error'); SoundEngine.error();
    const msgMap = {
      bot_not_admin: 'Bot bu kanalda admin emas.',
      user_not_admin: 'Siz bu kanalda admin emassiz.',
      channel_not_found: 'Kanal topilmadi.',
      send_failed: 'Kanalga xabar yuborib bo\'lmadi.',
      subscription_required: 'Avval majburiy kanallarga obuna bo\'ling.'
    };
    toast(msgMap[e.message] || 'Xatolik yuz berdi', 'error');
    if (e.message === 'subscription_required') checkGateAndInit();
    submitBtn.disabled = false;
    submitBtn.textContent = '🚀 Yaratish va yuborish';
  }
}

document.getElementById('success-done').addEventListener('click', () => {
  haptic('light'); SoundEngine.tap();
  showView('view-home');
  loadMineTab();
});
wireInteractive(document.getElementById('success-done'), { sound: 'success' });

// ============================================================
//   HOME: mode-card bosilganda wizard boshlash
// ============================================================
document.querySelectorAll('.mode-card').forEach(card => {
  wireInteractive(card, { sound: 'primary', hapticKind: 'medium' });
  card.addEventListener('click', () => startWizard(card.dataset.mode));
});

// ============================================================
//   SPLASH SCREEN — kamida 3000ms ko'rinib turadi. Ma'lumot
//   yuklanishi (checkGateAndInit) shu bilan PARALLEL ishlaydi,
//   shunda umumiy kutish vaqti max(3s, yuklash vaqti) bo'ladi,
//   3s + yuklash vaqti emas.
// ============================================================
const SPLASH_MIN_MS = 4200;

function hideSplash() {
  const splash = document.getElementById('splash');
  if (!splash) return;
  splash.classList.add('splash-out');
  setTimeout(() => splash.remove(), 650);
}

async function boot() {
  const splashTimer = new Promise(resolve => setTimeout(resolve, SPLASH_MIN_MS));
  await Promise.all([checkGateAndInit(), splashTimer]);
  hideSplash();
}

// ============================================================
//   BOSHLASH
// ============================================================
boot();
