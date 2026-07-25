const { users, settings, saveUsers } = require('./db');

// ============================================================
//   MINI APP CAPTCHA
//   Foydalanuvchi Mini App'ga birinchi marta kirganda oddiy
//   matematik savol beriladi (masalan "4 + 7 = ?"), pastda bir
//   nechta raqamli tugma chiqadi, foydalanuvchi to'g'ri javobni
//   bosishi kerak. Noto'g'ri javob — urinish kamayadi; urinishlar
//   tugasa (admin panelda sozlanadigan son, standart 5), foydalanuvchi
//   ma'lum muddatga (admin panelda sozlanadigan, standart 60 daqiqa)
//   Mini App'dan vaqtincha bloklanadi.
//
//   Savolning o'zi (to'g'ri javob) faqat server xotirasida (in-memory)
//   saqlanadi — hech qachon клиентга yuborilmaydi, faqat variant
//   matnlari yuboriladi. Shu tufayli foydalanuvchi devtools orqali
//   javobni ko'ra olmaydi.
// ============================================================
const pendingQuestions = new Map(); // userId -> { answer, expiresAt }
const QUESTION_TTL_MS = 5 * 60 * 1000; // savol 5 daqiqa amal qiladi

function getCaptchaConfig() {
  const cfg = settings.miniAppCaptcha || {};
  return {
    maxAttempts: cfg.maxAttempts || 5,
    blockMinutes: cfg.blockMinutes || 60
  };
}

function ensureUserRecord(userId) {
  const uid = String(userId);
  if (!users[uid]) {
    users[uid] = { id: userId, joinedAt: Date.now() };
  }
  return users[uid];
}

function getCaptchaStatus(userId) {
  const u = ensureUserRecord(userId);
  const now = Date.now();

  if (u.miniAppBlockedUntil && u.miniAppBlockedUntil > now) {
    return { state: 'blocked', blockedUntil: u.miniAppBlockedUntil };
  }
  if (u.miniAppBlockedUntil && u.miniAppBlockedUntil <= now) {
    // Blok muddati tugagan — urinishlarni tozalab, qaytadan boshlaymiz
    u.miniAppBlockedUntil = null;
    u.miniAppCaptchaAttempts = 0;
    saveUsers();
  }
  if (u.miniAppVerified) {
    return { state: 'verified' };
  }
  return { state: 'pending', attemptsLeft: getCaptchaConfig().maxAttempts - (u.miniAppCaptchaAttempts || 0) };
}

// Berilgan to'g'ri javobga yaqin, lekin noyob (takrorlanmas) noto'g'ri
// variantlar generatsiya qiladi — foydalanuvchi taxmin bilan topa olmasin
// deb variantlar to'g'ri javobga yaqin oraliqda tanlanadi.
function generateOptions(correct) {
  const options = new Set([correct]);
  while (options.size < 4) {
    const delta = Math.floor(Math.random() * 9) - 4; // -4..+4
    const candidate = correct + delta;
    if (candidate > 0 && candidate !== correct) options.add(candidate);
  }
  return shuffle([...options]);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createQuestion(userId) {
  const a = Math.floor(Math.random() * 9) + 2; // 2..10
  const b = Math.floor(Math.random() * 9) + 1; // 1..9
  const useMinus = Math.random() < 0.35 && a > b;
  const answer = useMinus ? a - b : a + b;
  const question = useMinus ? `${a} − ${b}` : `${a} + ${b}`;

  pendingQuestions.set(String(userId), { answer, expiresAt: Date.now() + QUESTION_TTL_MS });

  return { question, options: generateOptions(answer) };
}

function verifyAnswer(userId, submittedAnswer) {
  const uid = String(userId);
  const u = ensureUserRecord(userId);
  const cfg = getCaptchaConfig();

  const status = getCaptchaStatus(userId);
  if (status.state === 'blocked') return { ok: false, blocked: true, blockedUntil: status.blockedUntil };
  if (status.state === 'verified') return { ok: true, alreadyVerified: true };

  const pending = pendingQuestions.get(uid);
  if (!pending || Date.now() > pending.expiresAt) {
    return { ok: false, expired: true };
  }

  if (Number(submittedAnswer) === pending.answer) {
    u.miniAppVerified = true;
    u.miniAppCaptchaAttempts = 0;
    u.miniAppBlockedUntil = null;
    pendingQuestions.delete(uid);
    saveUsers();
    return { ok: true };
  }

  u.miniAppCaptchaAttempts = (u.miniAppCaptchaAttempts || 0) + 1;
  pendingQuestions.delete(uid);

  if (u.miniAppCaptchaAttempts >= cfg.maxAttempts) {
    u.miniAppBlockedUntil = Date.now() + cfg.blockMinutes * 60 * 1000;
    saveUsers();
    return { ok: false, blocked: true, blockedUntil: u.miniAppBlockedUntil };
  }

  saveUsers();
  return { ok: false, attemptsLeft: cfg.maxAttempts - u.miniAppCaptchaAttempts };
}

module.exports = { getCaptchaConfig, getCaptchaStatus, createQuestion, verifyAnswer };
