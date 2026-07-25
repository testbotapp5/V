const { users, saveUsers, settings } = require('./db');

function generateId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function getUser(ctx) {
  const id    = String(ctx.from.id);
  const uname = ctx.from.username || null;
  if (!users[id]) {
    users[id] = {
      id: ctx.from.id, username: uname,
      wins: 0, loses: 0, votes: 0, banned: false,
      createdBattles: 0, joinedBattles: 0,
      randomJoined: 0, activityScore: 0
    };
    saveUsers();
  }
  if (uname && users[id].username !== uname) {
    users[id].username = uname;
    saveUsers();
  }
  return users[id];
}

function bumpActivity(userId, amount = 1) {
  const id = String(userId);
  if (!users[id]) return;
  users[id].activityScore = (users[id].activityScore || 0) + amount;
  saveUsers();
}

function findUserByQuery(query) {
  const q = query.replace('@', '').toLowerCase().trim();
  if (users[q]) return users[q];
  return Object.values(users).find(u => u.username && u.username.toLowerCase() === q) || null;
}

function topActiveUsers(limit = 10) {
  return Object.values(users)
    .filter(u => !u.banned)
    .sort((a, b) => (b.activityScore || 0) - (a.activityScore || 0))
    .slice(0, limit);
}

// ============================================================
//                  SUBSCRIPTION CHECK
// ============================================================
async function isMemberOf(bot, userId, channel) {
  try {
    const m = await bot.telegram.getChatMember(channel, userId);
    return !['left', 'kicked'].includes(m.status);
  } catch (e) {
    // MUHIM: Telegram "user not found" (yoki shunga o'xshash) xatoni
    // aynan foydalanuvchi kanalga umuman a'zo bo'lmagan/kirmagan hollarda
    // qaytaradi — bu holat "obuna emas" degani, "bloklamaymiz" emas!
    // Faqat bot o'zi kanalni topa olmasa yoki kanalda umuman ishtirok
    // eta olmasa (masalan botni kanaldan chiqarib yuborishgan, yoki
    // kanal username o'zgargan) — shu holatlardagina, tekshiruvni
    // bajarib bo'lmagani uchun, foydalanuvchini bloklamaymiz.
    const desc = (e && e.description) || (e && e.message) || '';
    const benign = /chat not found|bot is not a member|not enough rights|CHAT_ADMIN_REQUIRED/i.test(desc);
    return benign; // bot/kanal muammosi bo'lsa — o'tkazamiz; user muammosi bo'lsa — bloklaymiz
  }
}

async function checkRequiredChannels(bot, userId) {
  if (!settings.requiredChannels || settings.requiredChannels.length === 0) return true;
  for (const ch of settings.requiredChannels) {
    if (!(await isMemberOf(bot, userId, ch))) return false;
  }
  return true;
}

async function isChannelAdminOf(bot, userId, chatId) {
  try {
    const m = await bot.telegram.getChatMember(chatId, userId);
    return ['administrator', 'creator'].includes(m.status);
  } catch (e) {
    return false;
  }
}

async function botIsAdminOf(bot, chatId) {
  try {
    const me = await bot.telegram.getMe();
    const member = await bot.telegram.getChatMember(chatId, me.id);
    return ['administrator', 'creator'].includes(member.status);
  } catch (e) { return false; }
}

// Berilgan chatId ro'yxati ichidan foydalanuvchi admin bo'lgan barcha chatId'larni qaytaradi.
// So'rovlar rate-limit (429) xavfini kamaytirish uchun kichik guruhlarda bajariladi
// (bir vaqtning o'zida cheksiz ko'p so'rov yubormaslik uchun).
const ADMIN_CHECK_CONCURRENCY = 6;

async function filterChatsWhereUserIsAdmin(bot, userId, chatIds) {
  const uniqueIds = [...new Set(chatIds.map(String))];
  const result = new Set();
  const queue = [...uniqueIds];

  const runners = new Array(Math.min(ADMIN_CHECK_CONCURRENCY, queue.length)).fill(null).map(async () => {
    while (queue.length > 0) {
      const id = queue.shift();
      const ok = await isChannelAdminOf(bot, userId, id);
      if (ok) result.add(id);
    }
  });
  await Promise.all(runners);
  return result;
}

// ============================================================
//             SIMPLE CAPTCHA (botda)
// ============================================================
const pendingCaptcha = {}; // userId -> { answer, runAction }

function makeCaptcha() {
  const a = Math.floor(Math.random() * 8) + 1;
  const b = Math.floor(Math.random() * 8) + 1;
  return { question: `${a} + ${b} = ?`, answer: a + b };
}

async function requireCaptchaThen(ctx, cancelMenu, runAction) {
  const cap = makeCaptcha();
  pendingCaptcha[String(ctx.from.id)] = { answer: cap.answer, runAction };
  await ctx.reply(
    `🤖 <b>Captcha tekshiruvi</b>\n\nRobot emasligingizni isbotlash uchun javob yozing:\n\n<b>${cap.question}</b>`,
    { parse_mode: 'HTML', ...cancelMenu() }
  );
}

// ============================================================
//        GMT+5 SANA/VAQT PARSER ("26.06.28 20:00" formatida)
// ============================================================
// Format: DD.MM.YY HH:mm  (kiritilgan vaqt GMT+5 deb hisoblanadi)
function parseGmt5DateTime(str) {
  const m = String(str).trim().match(/^(\d{2})\.(\d{2})\.(\d{2})\s+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [, dd, mm, yy, hh, min] = m;
  const day = parseInt(dd, 10);
  const month = parseInt(mm, 10);
  const year = 2000 + parseInt(yy, 10);
  const hour = parseInt(hh, 10);
  const minute = parseInt(min, 10);

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;

  // GMT+5 mahalliy vaqtni UTC ga o'tkazamiz: UTC = local - 5h
  const utcMs = Date.UTC(year, month - 1, day, hour - 5, minute, 0);
  if (isNaN(utcMs)) return null;
  return utcMs; // ms since epoch (UTC), keyinchalik Date.now() bilan solishtiriladi
}

function formatGmt5(ms) {
  const d = new Date(ms + 5 * 60 * 60 * 1000); // UTC + 5h = GMT+5 mahalliy
  const pad = n => String(n).padStart(2, '0');
  const dd = pad(d.getUTCDate());
  const mm = pad(d.getUTCMonth() + 1);
  const yy = pad(d.getUTCFullYear() % 100);
  const hh = pad(d.getUTCHours());
  const min = pad(d.getUTCMinutes());
  return `${dd}.${mm}.${yy} ${hh}:${min} (GMT+5)`;
}

module.exports = {
  generateId,
  getUser,
  bumpActivity,
  findUserByQuery,
  topActiveUsers,
  isMemberOf,
  checkRequiredChannels,
  isChannelAdminOf,
  botIsAdminOf,
  filterChatsWhereUserIsAdmin,
  pendingCaptcha,
  requireCaptchaThen,
  parseGmt5DateTime,
  formatGmt5
};
