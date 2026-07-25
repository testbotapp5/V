const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { BOT_TOKEN, BOT_USERNAME, PORT } = require('./config');
const {
  battles, contests, likebatls, users, templates, settings,
  saveBattles, saveContests, saveLikebatls, saveTemplates
} = require('./db');
const { generateId, checkRequiredChannels, isMemberOf } = require('./helpers');
const Captcha = require('./miniAppCaptcha');

// ============================================================
//   initData TASDIQLASH (Telegram rasmiy algoritmi):
//   Mini App'dan kelgan har bir so'rov Telegram.WebApp.initData
//   qatorini birga olib keladi. Bu qatorni HMAC-SHA256 bilan
//   tekshirib, haqiqatan Telegram tomonidan yaratilganini
//   (soxta bo'lmaganini) tasdiqlaymiz — aks holda istalgan kishi
//   o'zini istalgan foydalanuvchi userId qilib ko'rsatib API'ni
//   chaqira olardi.
// ============================================================
function verifyInitData(initData) {
  if (!initData) { console.warn('[auth] initData butunlay yo\'q (header kelmadi)'); return null; }
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) { console.warn('[auth] initData ichida hash yo\'q'); return null; }
  params.delete('hash');

  const pairs = [];
  for (const [key, value] of params.entries()) pairs.push(`${key}=${value}`);
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) {
    console.warn('[auth] HASH MOS EMAS — sabab odatda BOT_TOKEN Railway Variables\'dagi bilan botning haqiqiy tokeni bir xil emasligi.',
      { gotHash: hash.slice(0, 10) + '…', expectedHash: computedHash.slice(0, 10) + '…', botTokenPrefix: (BOT_TOKEN || '').slice(0, 8) + '…' });
    return null;
  }

  const authDate = parseInt(params.get('auth_date') || '0', 10);
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (ageSeconds > 86400) { console.warn('[auth] initData eskirgan', { ageSeconds }); return null; }

  const userRaw = params.get('user');
  if (!userRaw) { console.warn('[auth] initData ichida user maydoni yo\'q'); return null; }
  try { return JSON.parse(userRaw); } catch (e) { console.warn('[auth] user JSON parse xato', e.message); return null; }
}

// ============================================================
//   BRAUZERDA KIRISH (Telegram Login Widget):
//   Mini App faqat Telegram ilovasi ichida ochilganda initData
//   beradi. Oddiy brauzerda (Telegram tashqarisida) ochilganda esa
//   initData UMUMAN bo'lmaydi — buni "tekshiruvni o'chirib qo'yish"
//   orqali aylanib o'tib bo'lmaydi, chunki bu istalgan kishiga
//   o'zini istalgan Telegram foydalanuvchisi qilib ko'rsatish
//   imkonini berardi. Buning o'rniga rasmiy Telegram Login Widget
//   ishlatiladi — bu ham HMAC bilan (SHA256(bot_token) kaliti bilan,
//   Mini App'nikidan boshqacha, lekin xuddi shunday ishonchli formula
//   bilan) tekshiriladi. Muvaffaqiyatli bo'lsa, biz o'zimiz imzolagan
//   qisqa muddatli sessiya tokeni beramiz — buni brauzer keyingi
//   so'rovlarda header sifatida yuboradi.
// ============================================================
function verifyLoginWidgetData(data) {
  if (!data || !data.hash || !data.id) return null;
  const { hash, ...rest } = data;
  const pairs = Object.keys(rest)
    .filter(k => rest[k] !== undefined && rest[k] !== null)
    .sort()
    .map(k => `${k}=${rest[k]}`);
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHash('sha256').update(BOT_TOKEN).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (computedHash !== hash) { console.warn('[auth] Login Widget HASH MOS EMAS'); return null; }

  const authDate = parseInt(rest.auth_date || '0', 10);
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (ageSeconds > 86400) { console.warn('[auth] Login Widget ma\'lumoti eskirgan'); return null; }

  return {
    id: parseInt(rest.id, 10),
    first_name: rest.first_name,
    last_name: rest.last_name,
    username: rest.username,
    photo_url: rest.photo_url
  };
}

const SESSION_TTL_SECONDS = 7 * 24 * 3600; // 7 kun

function signSession(user) {
  const payload = { u: user, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', BOT_TOKEN).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

function verifySession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  const expectedSig = crypto.createHmac('sha256', BOT_TOKEN).update(payloadB64).digest('base64url');
  if (sig !== expectedSig) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.u;
  } catch (e) { return null; }
}

function authMiddleware(req, res, next) {
  const initData = req.headers['x-telegram-init-data'] || (req.body && req.body.initData);
  const sessionToken = req.headers['x-session-token'];

  const tgUser = verifyInitData(initData);
  if (tgUser) { req.tgUser = tgUser; req.authVia = 'miniapp'; return next(); }

  const sessionUser = verifySession(sessionToken);
  if (sessionUser) { req.tgUser = sessionUser; req.authVia = 'browser'; return next(); }

  return res.status(401).json({ error: 'invalid_init_data' });
}

// ============================================================
//   MAJBURIY OBUNA: admin panelda (/admin → Kanal qo'shish/o'chirish)
//   belgilangan kanallar — botdagi bilan bir xil ro'yxat (settings.
//   requiredChannels), Mini App ham shu ro'yxatni qayta ishlatadi.
//   Bu middleware battle/konkurs YARATISH so'rovlaridan oldin
//   ishlatiladi (botdagi bilan bir xil xatti-harakat).
// ============================================================
async function requireSubscriptionMiddleware(req, res, next) {
  const bot = req.app.get('botInstance');
  const ok = await checkRequiredChannels(bot, req.tgUser.id);
  if (!ok) {
    return res.status(403).json({
      error: 'subscription_required',
      channels: settings.requiredChannels
    });
  }
  next();
}

// ============================================================
//   CAPTCHA MAJBURIYLIGI: yaratish so'rovlaridan oldin foydalanuvchi
//   captchadan o'tganligini tekshiradi. Faqat birinchi marta talab
//   qilinadi — o'tgach doimiy "verified" bo'lib qoladi.
// ============================================================
function requireCaptchaMiddleware(req, res, next) {
  const status = Captcha.getCaptchaStatus(req.tgUser.id);
  if (status.state === 'blocked') {
    return res.status(403).json({ error: 'captcha_blocked', blockedUntil: status.blockedUntil });
  }
  if (status.state === 'pending') {
    return res.status(403).json({ error: 'captcha_required' });
  }
  next();
}

async function verifyChannelAdmin(bot, channel, userId) {
  const chat = await bot.telegram.getChat(channel);
  const me = await bot.telegram.getChatMember(channel, (await bot.telegram.getMe()).id);
  if (!['administrator', 'creator'].includes(me.status)) {
    const err = new Error('bot_not_admin'); err.code = 'bot_not_admin'; throw err;
  }
  const requester = await bot.telegram.getChatMember(channel, userId);
  if (!['administrator', 'creator'].includes(requester.status)) {
    const err = new Error('user_not_admin'); err.code = 'user_not_admin'; throw err;
  }
  return chat;
}

function createServer() {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'miniapp')));

  // ── Ochiq konfiguratsiya: brauzer versiyasi Login Widget'ni chizish uchun
  //    bot username'ini shu yerdan oladi (auth talab qilinmaydi) ──
  app.get('/api/config', (req, res) => {
    res.json({ botUsername: BOT_USERNAME });
  });

  // ── Brauzerda "Telegram orqali kirish" — Login Widget shu yerga POST qiladi ──
  app.post('/api/auth/telegram-login', (req, res) => {
    const user = verifyLoginWidgetData(req.body);
    if (!user) return res.status(401).json({ error: 'invalid_login_data' });
    const token = signSession(user);
    res.json({ sessionToken: token, user: { id: user.id, firstName: user.first_name, username: user.username } });
  });

  // ── Foydalanuvchining o'zi haqidagi ma'lumot + shablonlari + obuna holati ──
  app.get('/api/me', authMiddleware, async (req, res) => {
    const bot = req.app.get('botInstance');
    const uid = String(req.tgUser.id);
    const u = users[uid] || {};
    const myTemplates = Object.values(templates).filter(t => t.owner === req.tgUser.id);
    const subscribed = await checkRequiredChannels(bot, req.tgUser.id);
    const captchaStatus = Captcha.getCaptchaStatus(req.tgUser.id);

    res.json({
      id: req.tgUser.id,
      firstName: req.tgUser.first_name,
      username: req.tgUser.username || null,
      authVia: req.authVia,
      stats: {
        createdBattles: u.createdBattles || 0,
        votes: u.votes || 0,
        wins: u.wins || 0
      },
      templates: myTemplates.map(t => ({ id: t.templateId, name: t.name, type: t.type, text: t.text, target: t.target })),
      subscription: { required: settings.requiredChannels.length > 0, ok: subscribed, channels: settings.requiredChannels },
      captcha: captchaStatus
    });
  });

  // ── Captcha: yangi savol so'rash ──
  app.get('/api/captcha/question', authMiddleware, (req, res) => {
    const status = Captcha.getCaptchaStatus(req.tgUser.id);
    if (status.state === 'blocked') return res.status(403).json({ error: 'captcha_blocked', blockedUntil: status.blockedUntil });
    if (status.state === 'verified') return res.json({ verified: true });

    const q = Captcha.createQuestion(req.tgUser.id);
    res.json({ verified: false, question: q.question, options: q.options, attemptsLeft: status.attemptsLeft });
  });

  // ── Captcha: javobni tekshirish ──
  app.post('/api/captcha/verify', authMiddleware, (req, res) => {
    const { answer } = req.body || {};
    if (answer === undefined) return res.status(400).json({ error: 'answer_required' });

    const result = Captcha.verifyAnswer(req.tgUser.id, answer);
    if (result.blocked) return res.status(403).json({ error: 'captcha_blocked', blockedUntil: result.blockedUntil });
    if (!result.ok) {
      if (result.expired) return res.status(400).json({ error: 'captcha_expired' });
      return res.status(400).json({ error: 'wrong_answer', attemptsLeft: result.attemptsLeft });
    }
    res.json({ ok: true });
  });

  // ── Majburiy kanallarga qayta tekshiruv (foydalanuvchi obuna bo'lgach "Tekshirish" bosganda) ──
  app.get('/api/check-subscription', authMiddleware, async (req, res) => {
    const bot = req.app.get('botInstance');
    const ok = await checkRequiredChannels(bot, req.tgUser.id);
    res.json({ ok, channels: settings.requiredChannels });
  });

  // ── Foydalanuvchi admin bo'lgan (bot ham admin bo'lgan) kanal ekanini tekshirish ──
  app.post('/api/verify-channel', authMiddleware, async (req, res) => {
    const { channel } = req.body || {};
    if (!channel || typeof channel !== 'string') return res.status(400).json({ error: 'channel_required' });
    const ch = channel.startsWith('@') ? channel : '@' + channel;
    const bot = req.app.get('botInstance');

    try {
      const chat = await verifyChannelAdmin(bot, ch, req.tgUser.id);
      res.json({ ok: true, chatId: chat.id, title: chat.title || ch });
    } catch (e) {
      res.status(400).json({ error: e.code || 'channel_not_found', message: e.message });
    }
  });

  // ============================================================
  //   OVOZ BATTLE (#boshla bilan bir xil funksiya)
  // ============================================================
  app.post('/api/battle/create', authMiddleware, requireCaptchaMiddleware, requireSubscriptionMiddleware, async (req, res) => {
    const { text, target, endAt, channel, chatId, saveAsTemplate, templateName } = req.body || {};
    if (!channel || !chatId) return res.status(400).json({ error: 'channel_required' });

    const bot = req.app.get('botInstance');
    const VoteBattle = require('./modules/voteBattle');

    // Kanalni yana bir marta tasdiqlaymiz (frontend chatId'ni o'zgartirib
    // yubormasin, va vaqt o'tib admin huquqi bekor qilingan bo'lishi mumkin)
    try { await verifyChannelAdmin(bot, channel, req.tgUser.id); }
    catch (e) { return res.status(400).json({ error: e.code || 'channel_not_found' }); }

    const battleId = generateId();
    const battle = {
      battleId, owner: req.tgUser.id, channel, chatId,
      text: (text || '').trim(), target: Number(target) || 0,
      endAt: endAt ? Number(endAt) : null,
      active: true, participants: [], votes: {},
      messageId: null, createdAt: Date.now()
    };
    battles[battleId] = battle;

    const uid = String(req.tgUser.id);
    if (users[uid]) users[uid].createdBattles = (users[uid].createdBattles || 0) + 1;
    saveBattles();

    try {
      const msg = await bot.telegram.sendMessage(
        channel, VoteBattle.buildBattlePost(battle),
        { parse_mode: 'HTML', reply_markup: VoteBattle.buildBattleKeyboard(battle).reply_markup }
      );
      battle.messageId = msg.message_id;
      saveBattles();
    } catch (e) {
      delete battles[battleId];
      saveBattles();
      return res.status(400).json({ error: 'send_failed', message: e.message });
    }

    if (saveAsTemplate && templateName) {
      const templateId = generateId();
      templates[templateId] = {
        templateId, owner: req.tgUser.id, type: 'battle',
        name: String(templateName).slice(0, 40), text: battle.text, target: battle.target,
        createdAt: Date.now()
      };
      saveTemplates();
    }

    res.json({ ok: true, battleId });
  });

  // ============================================================
  //   RANDOM KONKURS (#random bilan bir xil funksiya)
  // ============================================================
  app.post('/api/contest/create', authMiddleware, requireCaptchaMiddleware, requireSubscriptionMiddleware, async (req, res) => {
    const { text, winCount, targetParticipants, endAt, channel, chatId, saveAsTemplate, templateName } = req.body || {};
    if (!channel || !chatId) return res.status(400).json({ error: 'channel_required' });

    const bot = req.app.get('botInstance');
    const RandomContest = require('./modules/randomContest');

    try { await verifyChannelAdmin(bot, channel, req.tgUser.id); }
    catch (e) { return res.status(400).json({ error: e.code || 'channel_not_found' }); }

    const contestId = generateId();
    const contest = {
      contestId, type: 'random', owner: req.tgUser.id, channel, chatId,
      text: (text || '').trim() || 'Random konkurs boshlandi!',
      winCount: Math.max(1, Number(winCount) || 1),
      targetParticipants: Number(targetParticipants) || 0,
      endAt: endAt ? Number(endAt) : null,
      participants: [], winners: [], active: true,
      createdAt: Date.now(), messageId: null
    };
    contests[contestId] = contest;
    saveContests();

    try {
      const msg = await bot.telegram.sendMessage(
        channel, RandomContest.buildRandomPost(contest),
        { parse_mode: 'HTML', reply_markup: RandomContest.buildRandomKeyboard(contest).reply_markup }
      );
      contest.messageId = msg.message_id;
      saveContests();
    } catch (e) {
      delete contests[contestId];
      saveContests();
      return res.status(400).json({ error: 'send_failed', message: e.message });
    }

    if (saveAsTemplate && templateName) {
      const templateId = generateId();
      templates[templateId] = {
        templateId, owner: req.tgUser.id, type: 'random',
        name: String(templateName).slice(0, 40), text: contest.text, winCount: contest.winCount,
        createdAt: Date.now()
      };
      saveTemplates();
    }

    res.json({ ok: true, contestId });
  });

  // ============================================================
  //   LIKE BATTLE (#batl bilan bir xil funksiya)
  //   Botdagi kabi, Mini App orqali yaratilgan like battle darhol
  //   "setupDone: true" bilan boshlanadi (ball sozlamalari wizard
  //   ichida to'liq so'raladi, alohida botga o'tish shart emas).
  // ============================================================
  app.post('/api/likebatl/create', authMiddleware, requireCaptchaMiddleware, requireSubscriptionMiddleware, async (req, res) => {
    const { pointsPerReaction, pointsPerStars, pointsPerComment, endAt, channel, chatId } = req.body || {};
    if (!channel || !chatId) return res.status(400).json({ error: 'channel_required' });

    const bot = req.app.get('botInstance');
    const LikeBattle = require('./modules/likeBattle');

    try { await verifyChannelAdmin(bot, channel, req.tgUser.id); }
    catch (e) { return res.status(400).json({ error: e.code || 'channel_not_found' }); }

    const battleId = generateId();
    const lb = {
      battleId, owner: req.tgUser.id, channel, chatId,
      participants: [],
      pointsPerReaction: Math.max(0, Number(pointsPerReaction) || 1),
      pointsPerStars: Math.max(0, Number(pointsPerStars) || 5),
      pointsPerComment: Math.max(0, Number(pointsPerComment) || 2),
      endAt: endAt ? Number(endAt) : null,
      active: true, setupDone: true, createdAt: Date.now(),
      announceMessageId: null, messageId: null
    };
    likebatls[battleId] = lb;
    saveLikebatls();

    try {
      const msg = await bot.telegram.sendMessage(
        channel, LikeBattle.buildLikebatlIntroPost(lb),
        { parse_mode: 'HTML', reply_markup: LikeBattle.buildLikebatlIntroKeyboard(lb).reply_markup }
      );
      lb.messageId = msg.message_id;
      saveLikebatls();
    } catch (e) {
      delete likebatls[battleId];
      saveLikebatls();
      return res.status(400).json({ error: 'send_failed', message: e.message });
    }

    res.json({ ok: true, battleId });
  });

  // ============================================================
  //   "MENINGLAR" RO'YXATLARI — botdagi 3 ta menyuning Mini App
  //   ekvivalenti (📋 Mening ovoz battlelarim / 🎲 Mening konkurslarim
  //   / 🥊 Mening like battlelarim).
  // ============================================================
  app.get('/api/mine', authMiddleware, (req, res) => {
    const uid = req.tgUser.id;

    const myBattles = Object.values(battles)
      .filter(b => b.owner === uid)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 30)
      .map(b => ({
        id: b.battleId, kind: 'battle', text: b.text, active: b.active,
        participants: b.participants.length, count: Object.keys(b.votes).length,
        channel: b.channel, target: b.target, endAt: b.endAt
      }));

    const myContests = Object.values(contests)
      .filter(c => c.owner === uid)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 30)
      .map(c => ({
        id: c.contestId, kind: 'random', text: c.text, active: c.active,
        participants: c.participants.length, count: c.participants.length,
        channel: c.channel, target: c.targetParticipants, endAt: c.endAt, winCount: c.winCount
      }));

    const myLikebatls = Object.values(likebatls)
      .filter(l => l.owner === uid)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 30)
      .map(l => ({
        id: l.battleId, kind: 'like', text: `${l.participants.length} ishtirokchi`, active: l.active,
        participants: l.participants.length,
        count: l.participants.reduce((s, p) => s + p.score, 0),
        channel: l.channel, endAt: l.endAt
      }));

    res.json({ battles: myBattles, contests: myContests, likebatls: myLikebatls });
  });

  // ── Umumiy statistika (botdagi "📊 Statistika" tugmasi bilan bir xil ma'lumot, faqat shaxsiy) ──
  app.get('/api/stats', authMiddleware, (req, res) => {
    const uid = String(req.tgUser.id);
    const u = users[uid] || {};
    res.json({
      createdBattles: u.createdBattles || 0,
      votes: u.votes || 0,
      wins: u.wins || 0,
      loses: u.loses || 0,
      joinedBattles: u.joinedBattles || 0,
      randomJoined: u.randomJoined || 0
    });
  });

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Mini App server ${PORT}-portda ishga tushdi (0.0.0.0).`);
  });

  return { app, server };
}

module.exports = { createServer, verifyInitData };
