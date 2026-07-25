const { isAdmin } = require('./config');

// ============================================================
//   ANTI-SPAM (Rate Limiting): qisqa vaqt ichida juda ko'p so'rov
//   yuborgan foydalanuvchini vaqtincha bloklaydi. Xotirada (in-memory)
//   ishlaydi — tashqi paket yoki baza kerak emas.
//
//   Qoida: WINDOW_MS ichida MAX_REQUESTS dan ortiq xabar/callback
//   yuborsa, BLOCK_MS davomida bot javob bermaydi (faqat birinchi
//   marta ogohlantirish yuboriladi, keyin jim bloklaydi — spamerga
//   qo'shimcha xabar yubormaslik uchun).
// ============================================================
const WINDOW_MS = 10 * 1000;   // 10 soniyalik oyna
const MAX_REQUESTS = 12;       // shu oynada ruxsat etilgan max so'rov
const BLOCK_MS = 60 * 1000;    // bloklash davomiyligi

const hits = new Map();    // userId -> [timestamp, timestamp, ...]
const blocked = new Map(); // userId -> blockUntil (ms)

function isCurrentlyBlocked(userId) {
  const until = blocked.get(userId);
  if (!until) return false;
  if (Date.now() >= until) { blocked.delete(userId); return false; }
  return true;
}

function registerHit(userId) {
  const now = Date.now();
  const arr = hits.get(userId) || [];
  const fresh = arr.filter(t => now - t < WINDOW_MS);
  fresh.push(now);
  hits.set(userId, fresh);
  return fresh.length;
}

// Eskirgan yozuvlarni vaqti-vaqti bilan tozalab turish (xotira oqib ketmasligi uchun)
setInterval(() => {
  const now = Date.now();
  for (const [uid, arr] of hits.entries()) {
    const fresh = arr.filter(t => now - t < WINDOW_MS);
    if (fresh.length === 0) hits.delete(uid); else hits.set(uid, fresh);
  }
  for (const [uid, until] of blocked.entries()) {
    if (now >= until) blocked.delete(uid);
  }
}, 5 * 60 * 1000).unref();

function antiSpamMiddleware() {
  return async (ctx, next) => {
    const userId = ctx.from && ctx.from.id;
    if (!userId) return next();
    if (isAdmin(userId)) return next(); // adminlar cheklanmaydi

    if (isCurrentlyBlocked(userId)) {
      // Bloklangan davrda jim — qo'shimcha xabar yubormaymiz (spamerni "band" qilmaslik uchun)
      if (ctx.callbackQuery) { try { await ctx.answerCbQuery(); } catch (e) {} }
      return;
    }

    const count = registerHit(userId);
    if (count > MAX_REQUESTS) {
      blocked.set(userId, Date.now() + BLOCK_MS);
      try {
        await ctx.reply(`⏳ Juda tez-tez so'rov yubordingiz. 1 daqiqaga vaqtincha cheklandingiz, birozdan so'ng qaytadan urinib ko'ring.`);
      } catch (e) {}
      return;
    }

    return next();
  };
}

module.exports = { antiSpamMiddleware };
