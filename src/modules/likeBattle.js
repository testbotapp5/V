const { Markup } = require('telegraf');
const { BOT_USERNAME } = require('../config');
const { likebatls, settings, saveLikebatls } = require('../db');
const {
  generateId, getUser, bumpActivity, isMemberOf, checkRequiredChannels,
  isChannelAdminOf, botIsAdminOf, requireCaptchaThen, parseGmt5DateTime, formatGmt5
} = require('../helpers');
const { setState, getState, clearState } = require('../state');
const { mainMenu, cancelMenu } = require('../keyboards');
const { registerButton, inlineBtn, inlineUrlBtn } = require('../buttons');

const DEFAULT_LIKEBATL_POINTS = { reaction: 1, stars: 5, comment: 2 };

// ── TUGMALARNI RO'YXATDAN O'TKAZISH ──
registerButton('lb_setup_open',      '🔵 Sozlash (faqat admin)', 'primary');
registerButton('lb_join',            '🟢 Battlega qo\'shilish', 'success');
registerButton('lb_reaction',        '❤️ Reaksiya', 'primary');
registerButton('lb_comment',         '💬 Comment', 'primary');
registerButton('lb_setup_reaction',  '❤️ Reaksiya balli (sozlash)', 'primary');
registerButton('lb_setup_stars',     '⭐ Stars balli (sozlash)', 'primary');
registerButton('lb_setup_comment',   '💬 Comment balli (sozlash)', 'primary');
registerButton('lb_setup_start',     '🟢 Boshlash', 'success');
registerButton('lb_manage_open',     '🥊 Like battle boshqaruvi (ochish)', 'primary');
registerButton('lb_edit_reaction',   '❤️ Reaksiya ballini o\'zgartirish', 'primary');
registerButton('lb_edit_stars',      '⭐ Stars ballini o\'zgartirish', 'primary');
registerButton('lb_edit_comment',    '💬 Comment ballini o\'zgartirish', 'primary');
registerButton('lb_stats',           '📊 Statistika', 'primary');
registerButton('lb_stop',            '🔴 Battle stop', 'danger');
registerButton('lb_setup_pending',   '🔵 Sozlanmoqda (ro\'yxat)', 'primary');
registerButton('lb_finished',        '🔴 Tugagan (ro\'yxat)', 'danger');
registerButton('lbc_edit_reaction',  '❤️ Reaksiya balli (yaratish sozlamasi)', 'primary');
registerButton('lbc_edit_stars',     '⭐ Stars balli (yaratish sozlamasi)', 'primary');
registerButton('lbc_edit_comment',   '💬 Comment balli (yaratish sozlamasi)', 'primary');
registerButton('lbc_continue',       '✅ Davom etish', 'success');
registerButton('lbc_stop_time',      '⏰ Vaqtga qarab', 'primary');
registerButton('lbc_stop_manual',    '🔴 O\'zim stop qilaman', 'danger');

// ── KANALDAGI "SOZLANMOQDA" E'LONI (faqat url tugma → bot) ──
function buildLikebatlAnnouncePost(lb) {
  return `🥊 <b>LIKE BATTLE!</b>\n\nKanal admini hozir battlani sozlamoqda. Tez orada qatnashish boshlanadi! ⏳`;
}

function buildLikebatlAnnounceKeyboard(lb) {
  return Markup.inlineKeyboard([
    [inlineUrlBtn('lb_setup_open', '🔵 Sozlash (faqat admin)', `https://t.me/${BOT_USERNAME}?start=lbsetup-${lb.battleId}`)]
  ]);
}

async function updateLikebatlAnnouncePost(bot, lb) {
  if (!lb.announceMessageId || !lb.chatId) return;
  try {
    await bot.telegram.editMessageText(
      lb.chatId, lb.announceMessageId, null,
      buildLikebatlAnnouncePost(lb),
      { parse_mode: 'HTML', reply_markup: buildLikebatlAnnounceKeyboard(lb).reply_markup }
    );
  } catch (e) { console.log('[LIKEBATL] announce edit xato:', e.message); }
}

// ── JONLI "QATNASHISH" POSTI ──
function buildLikebatlIntroPost(lb) {
  let text = `🏆 <b>LIKE BATTLE!</b>\n\n`;
  text += `Ball yig'ishni boshlang! Quyidagi tugmani bosib ishtirokchi bo'ling.\n\n`;
  text += `📌 <b>Ball tizimi:</b>\n`;
  text += `❤️ Reaksiya — ${lb.pointsPerReaction} ball\n`;
  text += `⭐ Stars — 1 Stars = ${lb.pointsPerStars} ball\n`;
  text += `💬 Comment — ${lb.pointsPerComment} ball\n\n`;
  if (lb.endAt) text += `⏰ Tugash vaqti: ${formatGmt5(lb.endAt)}\n\n`;
  text += `👥 Ishtirokchilar: ${lb.participants.length}`;
  return text;
}

function buildLikebatlIntroKeyboard(lb) {
  return Markup.inlineKeyboard([
    [inlineUrlBtn('lb_join', '🟢 Battlega qo\'shilish', `https://t.me/${BOT_USERNAME}?start=lbjoin-${lb.battleId}`)]
  ]);
}

async function updateLikebatlIntroPost(bot, lb) {
  if (!lb.messageId || !lb.chatId) return;
  try {
    await bot.telegram.editMessageText(
      lb.chatId, lb.messageId, null,
      buildLikebatlIntroPost(lb),
      { parse_mode: 'HTML', reply_markup: buildLikebatlIntroKeyboard(lb).reply_markup }
    );
  } catch (e) { console.log('[LIKEBATL] intro edit xato:', e.message); }
}

// ── ISHTIROKCHI POSTI — pastida ❤️ 💬 ⭐ tugmalari (kanalda ishlaydi) ──
function buildParticipantPost(p) {
  let text = `1️⃣ <b>Ishtirokchi</b>\n\n`;
  text += `👤 ${p.name}\n\n`;
  text += `Ball yig'ishni boshlang!\n\n`;
  text += `❤️ Reaksiya — ${p.pointsPerReaction} ball (${p.reactions} ta)\n`;
  text += `⭐ Stars (shu postga ⭐ reaction bosing) — ${p.pointsPerStars} ball/⭐ (${p.stars} ta)\n`;
  text += `💬 Comment — ${p.pointsPerComment} ball (${p.comments} ta)\n\n`;
  text += `🏆 <b>Jami ball:</b> ${p.score}`;
  return text;
}

function buildParticipantKeyboard(lb, p) {
  return Markup.inlineKeyboard([
    [
      inlineBtn('lb_reaction', `❤️ Reaksiya (${p.reactions})`, `lbreact_${lb.battleId}_${p.userId}`),
      inlineBtn('lb_comment', `💬 Comment (${p.comments})`, `lbcomment_${lb.battleId}_${p.userId}`)
    ]
  ]);
}

async function updateParticipantPost(bot, lb, p) {
  if (!p.messageId || !lb.chatId) return;
  try {
    await bot.telegram.editMessageText(
      lb.chatId, p.messageId, null,
      buildParticipantPost({ ...p, pointsPerReaction: lb.pointsPerReaction, pointsPerStars: lb.pointsPerStars, pointsPerComment: lb.pointsPerComment }),
      { parse_mode: 'HTML', reply_markup: buildParticipantKeyboard(lb, p).reply_markup }
    );
  } catch (e) { console.log('[LIKEBATL] participant edit xato:', e.message); }
}

function recalcScore(p, lb) {
  p.score = (p.reactions * lb.pointsPerReaction) + (p.stars * lb.pointsPerStars) + (p.comments * lb.pointsPerComment);
}

function findParticipant(lb, userId) {
  return lb.participants.find(p => String(p.userId) === String(userId));
}

function findParticipantByMessage(lb, messageId) {
  return lb.participants.find(p => String(p.messageId) === String(messageId));
}

// ── SOZLASH MENYUSI (botda, faqat kanal admini) ──
function buildLikebatlSetupMenu(lb) {
  let text = `⚙️ <b>#batl sozlamasi</b>\n\n📢 Kanal: ${lb.channel}\n\n`;
  text += `❤️ Reaksiya — <b>${lb.pointsPerReaction}</b> ball\n`;
  text += `⭐ Stars — <b>${lb.pointsPerStars}</b> ball / 1 Stars\n`;
  text += `💬 Comment — <b>${lb.pointsPerComment}</b> ball\n\n`;
  text += lb.endAt ? `⏰ Tugash: ${formatGmt5(lb.endAt)}\n\n` : `⏰ Tugash: qo'lda to'xtatiladi\n\n`;
  text += `Ballarni kerak bo'lsa o'zgartiring, tayyor bo'lsa "🟢 Boshlash"ni bosing.`;
  return text;
}

function buildLikebatlSetupKeyboard(lb) {
  return Markup.inlineKeyboard([
    [inlineBtn('lb_setup_reaction', `❤️ Reaksiya: ${lb.pointsPerReaction}`, `lbset_reaction_${lb.battleId}`)],
    [inlineBtn('lb_setup_stars', `⭐ Stars: ${lb.pointsPerStars}`, `lbset_stars_${lb.battleId}`)],
    [inlineBtn('lb_setup_comment', `💬 Comment: ${lb.pointsPerComment}`, `lbset_comment_${lb.battleId}`)],
    [inlineBtn('lb_setup_start', '🟢 Boshlash', `lbset_start_${lb.battleId}`)]
  ]);
}

async function autoCreateLikebatl(bot, chatId, channelUsername) {
  if (!(await botIsAdminOf(bot, chatId))) return;

  const alreadyPending = Object.values(likebatls).some(l => String(l.chatId) === String(chatId) && !l.setupDone);
  if (alreadyPending) return;

  const battleId = generateId();
  const lb = {
    battleId, owner: 0, channel: channelUsername, chatId,
    participants: [],
    pointsPerReaction: DEFAULT_LIKEBATL_POINTS.reaction,
    pointsPerStars: DEFAULT_LIKEBATL_POINTS.stars,
    pointsPerComment: DEFAULT_LIKEBATL_POINTS.comment,
    endAt: null,
    active: false, setupDone: false, createdAt: Date.now(),
    announceMessageId: null, messageId: null
  };
  likebatls[battleId] = lb;
  saveLikebatls();

  try {
    const msg = await bot.telegram.sendMessage(
      chatId, buildLikebatlAnnouncePost(lb),
      { parse_mode: 'HTML', reply_markup: buildLikebatlAnnounceKeyboard(lb).reply_markup }
    );
    lb.announceMessageId = msg.message_id;
    saveLikebatls();
  } catch (e) {
    console.log('[AUTO-BATL] xato:', e.message);
    delete likebatls[battleId];
    saveLikebatls();
  }
}

// ============================================================
//      SOZLASH (BOTDA, faqat kanal admini) — kanaldan kelganlar uchun
// ============================================================
async function handleLikebatlSetupEntry(bot, ctx, battleId) {
  const lb = likebatls[battleId];
  if (!lb) return ctx.reply('❌ Sozlama topilmadi.');
  if (lb.setupDone) return ctx.reply('✅ Bu battle allaqachon boshlangan.');

  const ok = await isChannelAdminOf(bot, ctx.from.id, lb.chatId);
  if (!ok) return ctx.reply('🚫 Faqat kanal admini sozlay oladi.');

  await ctx.reply(buildLikebatlSetupMenu(lb), {
    parse_mode: 'HTML',
    reply_markup: buildLikebatlSetupKeyboard(lb).reply_markup
  });
}

async function handleLikebatlJoin(bot, ctx, battleId) {
  const lb = likebatls[battleId];
  if (!lb) return ctx.reply('❌ Battle topilmadi.');
  if (!lb.active) return ctx.reply('❌ Battle tugagan.');

  const user = getUser(ctx);
  if (user.banned) return ctx.reply('🚫 Siz ban qilingansiz.');

  const uid = ctx.from.id;
  if (lb.participants.some(p => p.userId === uid)) {
    return ctx.reply('✅ Siz allaqachon ishtirokchisiz!');
  }

  const inChannel = await isMemberOf(bot, uid, lb.channel);
  if (!inChannel) {
    const channelLink = `https://t.me/${lb.channel.replace('@', '')}`;
    return ctx.reply(
      `❌ Qatnashish uchun avval ${lb.channel} kanaliga obuna bo'ling, so'ng qaytadan urinib ko'ring!`,
      Markup.inlineKeyboard([[inlineUrlBtn('lb_join', `📢 ${lb.channel} ga obuna bo'lish`, channelLink)]])
    );
  }

  const reqOk = await checkRequiredChannels(bot, uid);
  if (!reqOk) {
    const buttons = settings.requiredChannels.map(ch => [
      inlineUrlBtn('lb_join', `📢 ${ch}`, `https://t.me/${ch.replace('@', '')}`)
    ]);
    return ctx.reply('❌ Majburiy kanallarga obuna bo\'ling, so\'ng qaytadan urinib ko\'ring:', Markup.inlineKeyboard(buttons));
  }

  if (settings.captchaOnJoin) {
    return requireCaptchaThen(ctx, cancelMenu, async () => finalizeLikebatlJoin(bot, ctx, lb));
  }
  return finalizeLikebatlJoin(bot, ctx, lb);
}

async function finalizeLikebatlJoin(bot, ctx, lb) {
  const uid = ctx.from.id;
  const name = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || `ID:${uid}`);
  const participant = {
    userId: uid, name,
    reactions: 0, stars: 0, comments: 0, score: 0,
    reactedUserIds: [], commentedUserIds: [],
    messageId: null
  };
  lb.participants.push(participant);
  saveLikebatls();
  bumpActivity(uid, 2);

  await ctx.reply('✅ Battlega muvaffaqiyatli qo\'shildingiz! Postingiz kanalga joylanadi.', mainMenu());

  try {
    const msg = await bot.telegram.sendMessage(
      lb.chatId,
      buildParticipantPost({ ...participant, pointsPerReaction: lb.pointsPerReaction, pointsPerStars: lb.pointsPerStars, pointsPerComment: lb.pointsPerComment }),
      { parse_mode: 'HTML', reply_markup: buildParticipantKeyboard(lb, participant).reply_markup }
    );
    participant.messageId = msg.message_id;
    saveLikebatls();
  } catch (e) { console.log('[LIKEBATL] ishtirokchi post xato:', e.message); }

  await updateLikebatlIntroPost(bot, lb);
}

// ============================================================
//   ❤️ REAKSIYA TUGMASI — kanal postida callback.
//   Obuna bo'lmaganlar reaksiya bera olmaydi (rad etiladi).
//   1 user = 1 marta.
// ============================================================
function registerReactionButtonHandler(bot) {
  bot.action(/^lbreact_([^_]+)_(\d+)$/, async (ctx) => {
    const lb = likebatls[ctx.match[1]];
    if (!lb || !lb.active) return ctx.answerCbQuery('❌ Battle topilmadi yoki tugagan.', { show_alert: true });
    const p = findParticipant(lb, ctx.match[2]);
    if (!p) return ctx.answerCbQuery('❌ Ishtirokchi topilmadi.', { show_alert: true });

    const uid = ctx.from.id;

    // Obuna tekshiruvi — shu battle o'tayotgan kanalga obuna bo'lmagan bo'lsa rad etiladi
    const subscribed = await isMemberOf(bot, uid, lb.channel);
    if (!subscribed) {
      return ctx.answerCbQuery(`❌ Reaksiya berish uchun avval ${lb.channel} kanaliga obuna bo'ling!`, { show_alert: true });
    }

    if (!p.reactedUserIds) p.reactedUserIds = [];
    if (p.reactedUserIds.includes(uid)) {
      return ctx.answerCbQuery('✅ Siz allaqachon reaksiya bergansiz!', { show_alert: true });
    }

    p.reactedUserIds.push(uid);
    p.reactions += 1;
    recalcScore(p, lb);
    saveLikebatls();
    await updateParticipantPost(bot, lb, p);
    bumpActivity(uid, 1);

    await ctx.answerCbQuery('❤️ Reaksiya qo\'shildi!');
  });
}

// ============================================================
//   💬 COMMENT TUGMASI — botga o'tib matn yozadi, comment
//   ishtirokchi ovoz berilgan postga (kanalga) reply sifatida yuboriladi.
//   Obuna bo'lmaganlar comment ham yoza olmaydi. 1 user = 1 marta.
// ============================================================
function registerCommentButtonHandler(bot) {
  bot.action(/^lbcomment_([^_]+)_(\d+)$/, async (ctx) => {
    const lb = likebatls[ctx.match[1]];
    if (!lb || !lb.active) return ctx.answerCbQuery('❌ Battle topilmadi yoki tugagan.', { show_alert: true });
    const p = findParticipant(lb, ctx.match[2]);
    if (!p) return ctx.answerCbQuery('❌ Ishtirokchi topilmadi.', { show_alert: true });

    const uid = ctx.from.id;

    const subscribed = await isMemberOf(bot, uid, lb.channel);
    if (!subscribed) {
      return ctx.answerCbQuery(`❌ Comment yozish uchun avval ${lb.channel} kanaliga obuna bo'ling!`, { show_alert: true });
    }

    if (!p.commentedUserIds) p.commentedUserIds = [];
    if (p.commentedUserIds.includes(uid)) {
      return ctx.answerCbQuery('✅ Siz allaqachon comment qoldirgansiz!', { show_alert: true });
    }

    await ctx.answerCbQuery();
    setState(ctx.from.id, { step: 'lb_write_comment', battleId: lb.battleId, participantId: p.userId });
    await ctx.reply(`💬 ${p.name} uchun commentingizni yozib qoldiring:`, cancelMenu());
  });
}

// Matnli comment qabul qilish — markaziy text handler chaqiradi
async function handleCommentTextState(bot, ctx, state) {
  const lb = likebatls[state.battleId];
  if (!lb || !lb.active) { clearState(ctx.from.id); await ctx.reply('❌ Battle topilmadi yoki tugagan.', mainMenu()); return true; }
  const p = findParticipant(lb, state.participantId);
  if (!p) { clearState(ctx.from.id); await ctx.reply('❌ Ishtirokchi topilmadi.', mainMenu()); return true; }

  const uid = ctx.from.id;

  const subscribed = await isMemberOf(bot, uid, lb.channel);
  if (!subscribed) {
    clearState(ctx.from.id);
    await ctx.reply(`❌ Comment yozish uchun avval ${lb.channel} kanaliga obuna bo'ling!`, mainMenu());
    return true;
  }

  if (!p.commentedUserIds) p.commentedUserIds = [];
  if (p.commentedUserIds.includes(uid)) {
    clearState(ctx.from.id);
    await ctx.reply('✅ Siz allaqachon comment qoldirgansiz!', mainMenu());
    return true;
  }

  const commentText = ctx.message.text.trim();
  const fromName = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || `ID:${uid}`);

  p.commentedUserIds.push(uid);
  p.comments += 1;
  recalcScore(p, lb);
  saveLikebatls();
  await updateParticipantPost(bot, lb, p);
  bumpActivity(uid, 2);

  clearState(ctx.from.id);
  await ctx.reply('✅ Commentingiz yuborildi va ball qo\'shildi!', mainMenu());

  try {
    await bot.telegram.sendMessage(
      lb.chatId,
      `💬 <b>Yangi comment</b>\n👤 ${p.name} uchun:\n\n${fromName}: ${commentText}`,
      { parse_mode: 'HTML', reply_to_message_id: p.messageId }
    );
  } catch (e) { console.log('[LIKEBATL] comment kanalga yuborishda xato:', e.message); }

  return true;
}

// ============================================================
//   ⭐ STARS — kanaldagi ⭐ paid reaction orqali kuzatiladi.
//   Bot Stars invoice yubormaydi va o'z balansiga Stars yig'maydi;
//   foydalanuvchi ishtirokchi postiga Telegram ilovasining o'zidagi
//   native ⭐ (paid reaction) tugmasini bossa, kanal 100% Stars'ni
//   to'g'ridan-to'g'ri oladi, bot esa faqat shu reaksiyani
//   message_reaction update orqali ko'rib ballni yozadi.
//   Talab: bot kanalda admin bo'lishi va allowedUpdates ro'yxatida
//   'message_reaction' bo'lishi kerak (index.js da sozlangan).
// ============================================================
function registerPaidStarsWatcher(bot) {
  bot.on('message_reaction', async (ctx) => {
    const r = ctx.update.message_reaction;
    if (!r) return;

    const lb = Object.values(likebatls).find(l => String(l.chatId) === String(r.chat.id));
    if (!lb || !lb.active) return;
    const p = findParticipantByMessage(lb, r.message_id);
    if (!p) return;

    const oldPaidCount = (r.old_reaction || []).filter(x => x.type === 'paid').length;
    const newPaidCount = (r.new_reaction || []).filter(x => x.type === 'paid').length;
    const added = newPaidCount - oldPaidCount;
    if (added <= 0) return;

    // Reaksiya anonim bo'lmasa foydalanuvchi aniqlanadi; anonim bo'lsa
    // kimga tegishli ekanini bilib bo'lmaydi, shu sabab umumiy hisoblanadi.
    const actorId = r.user ? r.user.id : null;

    p.stars += added;
    recalcScore(p, lb);
    saveLikebatls();
    await updateParticipantPost(bot, lb, p);
    if (actorId) bumpActivity(actorId, 3);

    try {
      await bot.telegram.sendMessage(
        lb.chatId,
        `⭐ ${p.name} ${added} ta Stars oldi! (+${added * lb.pointsPerStars} ball)`,
        { reply_to_message_id: p.messageId }
      );
    } catch (e) {}
  });
}

// ============================================================
//   BATTLENI YAKUNLASH (vaqt tugashi yoki qo'lda to'xtatish orqali)
// ============================================================
async function finishLikebatl(bot, lb) {
  lb.active = false;
  lb.finishedAt = Date.now();
  saveLikebatls();

  const sorted = [...lb.participants].sort((a, b) => b.score - a.score);
  let text = `⛔ <b>LIKE BATTLE TUGADI!</b>\n\n🏆 <b>Yakuniy natijalar:</b>\n\n`;
  if (sorted.length === 0) text += 'Ishtirokchilar bo\'lmadi.';
  else sorted.forEach((p, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    text += `${medal} ${p.name} — ${p.score} ball\n`;
  });

  try { await bot.telegram.sendMessage(lb.chatId, text, { parse_mode: 'HTML' }); } catch (e) {}
}

// ============================================================
//   "MENING LIKE BATTLELARIM" MENYUSI (kanal admini ko'radi)
// ============================================================
async function showMyLikebatlsMenu(bot, ctx) {
  const all = Object.values(likebatls);
  const mine = [];
  for (const lb of all) {
    if (lb.owner === ctx.from.id || await isChannelAdminOf(bot, ctx.from.id, lb.chatId)) mine.push(lb);
  }
  if (mine.length === 0) {
    return ctx.reply(
      '🥊 Siz admin bo\'lgan kanallarda hali like battle yo\'q.\n\n"➕ Like battle yaratish" tugmasi orqali botda yarating, yoki kanalda <code>#batl</code> yozing.',
      { parse_mode: 'HTML', ...mainMenu() }
    );
  }

  const active   = mine.filter(l => l.active);
  const pending  = mine.filter(l => !l.setupDone && !l.active);
  const finished = mine.filter(l => l.setupDone === true && !l.active);
  const buttons  = [];

  active.forEach(l => buttons.push([inlineBtn('lb_manage_open', `🟢 ${l.channel} (${l.participants.length})`, `lbm_${l.battleId}`)]));
  pending.forEach(l => buttons.push([inlineBtn('lb_setup_pending', `🔵 ${l.channel} (sozlanmoqda)`, `lbsetupmenu_${l.battleId}`)]));
  finished.slice(0, 8).forEach(l => buttons.push([inlineBtn('lb_finished', `🔴 ${l.channel}`, `lbs_${l.battleId}`)]));

  await ctx.reply(`🥊 <b>Mening like battlelarim</b>\n\n🟢 Aktiv: ${active.length}\n🔵 Sozlanmoqda: ${pending.length}\n🔴 Tugagan: ${finished.length}`, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
}

// ============================================================
//   BOTDA LIKE BATTLE YARATISH WIZARD
//   1) matn  2) ball sozlamalari (tugma orqali edit)  3) qachon stop  4) kanal
// ============================================================
function buildCreateBallMenu(state) {
  let text = `⚙️ <b>Ball sozlamalari</b>\n\n`;
  text += `❤️ Reaksiya — <b>${state.pointsPerReaction}</b> ball\n`;
  text += `⭐ Stars — <b>${state.pointsPerStars}</b> ball / 1 Stars\n`;
  text += `💬 Comment — <b>${state.pointsPerComment}</b> ball\n\n`;
  text += `Kerak bo'lsa o'zgartiring, tayyor bo'lsa "✅ Davom etish"ni bosing.`;
  return text;
}

function buildCreateBallKeyboard() {
  return Markup.inlineKeyboard([
    [inlineBtn('lbc_edit_reaction', '❤️ Reaksiya ballini o\'zgartirish', 'lbc_edit_reaction')],
    [inlineBtn('lbc_edit_stars', '⭐ Stars ballini o\'zgartirish', 'lbc_edit_stars')],
    [inlineBtn('lbc_edit_comment', '💬 Comment ballini o\'zgartirish', 'lbc_edit_comment')],
    [inlineBtn('lbc_continue', '✅ Davom etish', 'lbc_continue')]
  ]);
}

function registerLikebatlCreationWizard(bot) {
  bot.hears('➕ Like battle yaratish', async (ctx) => {
    const user = getUser(ctx);
    if (user.banned) return ctx.reply('🚫 Siz ban qilingansiz.');
    setState(ctx.from.id, { step: 'lbc_text' });
    await ctx.reply(
      '🥊 <b>Like battle yaratish</b>\n\n📝 Battle matnini kiriting (faqat shu matn postga chiqadi):',
      { parse_mode: 'HTML', ...cancelMenu() }
    );
  });

  bot.action('lbc_edit_reaction', async (ctx) => {
    const state = getState(ctx.from.id);
    if (!state || state.step !== 'lbc_ballmenu') return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    state.step = 'lbc_input_reaction';
    setState(ctx.from.id, state);
    await ctx.reply(`❤️ Reaksiya uchun yangi ball kiriting (hozir: ${state.pointsPerReaction}):`, cancelMenu());
  });

  bot.action('lbc_edit_stars', async (ctx) => {
    const state = getState(ctx.from.id);
    if (!state || state.step !== 'lbc_ballmenu') return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    state.step = 'lbc_input_stars';
    setState(ctx.from.id, state);
    await ctx.reply(`⭐ Stars uchun yangi ball kiriting (hozir: ${state.pointsPerStars}):`, cancelMenu());
  });

  bot.action('lbc_edit_comment', async (ctx) => {
    const state = getState(ctx.from.id);
    if (!state || state.step !== 'lbc_ballmenu') return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    state.step = 'lbc_input_comment';
    setState(ctx.from.id, state);
    await ctx.reply(`💬 Comment uchun yangi ball kiriting (hozir: ${state.pointsPerComment}):`, cancelMenu());
  });

  bot.action('lbc_continue', async (ctx) => {
    const state = getState(ctx.from.id);
    if (!state || state.step !== 'lbc_ballmenu') return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    state.step = 'lbc_stop_choice';
    setState(ctx.from.id, state);
    try { await ctx.editMessageText('✅ Ball sozlamalari saqlandi.'); } catch (e) {}
    await ctx.reply(
      '🏁 Battle qachon to\'xtatilsin?',
      Markup.inlineKeyboard([
        [inlineBtn('lbc_stop_time', '⏰ Vaqtga qarab', 'lbc_stop_time')],
        [inlineBtn('lbc_stop_manual', '🔴 O\'zim stop qilaman', 'lbc_stop_manual')]
      ])
    );
  });

  bot.action('lbc_stop_time', async (ctx) => {
    const state = getState(ctx.from.id);
    if (!state || state.step !== 'lbc_stop_choice') return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    state.step = 'lbc_stop_time_input';
    setState(ctx.from.id, state);
    try { await ctx.editMessageText('⏰ Vaqtga qarab to\'xtatish tanlandi.'); } catch (e) {}
    await ctx.reply('Tugash vaqtini kiriting (GMT+5):\nFormat: <code>KK.OO.YY SS:DD</code>\nMisol: <code>26.06.28 20:00</code>', { parse_mode: 'HTML', ...cancelMenu() });
  });

  bot.action('lbc_stop_manual', async (ctx) => {
    const state = getState(ctx.from.id);
    if (!state || state.step !== 'lbc_stop_choice') return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    state.endAt = null;
    state.step = 'lbc_channel';
    setState(ctx.from.id, state);
    try { await ctx.editMessageText('🔴 O\'zim stop qilaman tanlandi.'); } catch (e) {}
    await ctx.reply('📢 Endi kanal username kiriting:\nMisol: @mychannel', cancelMenu());
  });
}

async function handleLikebatlCreationTextState(bot, ctx, state) {
  const text = ctx.message.text.trim();

  if (state.step === 'lbc_text') {
    state.battleText = text;
    state.pointsPerReaction = DEFAULT_LIKEBATL_POINTS.reaction;
    state.pointsPerStars = DEFAULT_LIKEBATL_POINTS.stars;
    state.pointsPerComment = DEFAULT_LIKEBATL_POINTS.comment;
    state.step = 'lbc_ballmenu';
    setState(ctx.from.id, state);
    await ctx.reply(buildCreateBallMenu(state), { parse_mode: 'HTML', reply_markup: buildCreateBallKeyboard().reply_markup });
    return true;
  }

  if (state.step === 'lbc_input_reaction' || state.step === 'lbc_input_stars' || state.step === 'lbc_input_comment') {
    const v = parseInt(text, 10);
    if (isNaN(v) || v < 0) { await ctx.reply('❌ To\'g\'ri son kiriting.', cancelMenu()); return true; }
    if (state.step === 'lbc_input_reaction') state.pointsPerReaction = v;
    if (state.step === 'lbc_input_stars') state.pointsPerStars = v;
    if (state.step === 'lbc_input_comment') state.pointsPerComment = v;
    state.step = 'lbc_ballmenu';
    setState(ctx.from.id, state);
    await ctx.reply('✅ Saqlandi.', mainMenu());
    await ctx.reply(buildCreateBallMenu(state), { parse_mode: 'HTML', reply_markup: buildCreateBallKeyboard().reply_markup });
    return true;
  }

  if (state.step === 'lbc_stop_time_input') {
    const ms = parseGmt5DateTime(text);
    if (!ms) { await ctx.reply('❌ Format noto\'g\'ri. Misol: 26.06.28 20:00', cancelMenu()); return true; }
    if (ms <= Date.now()) { await ctx.reply('❌ Bu vaqt allaqachon o\'tib ketgan.', cancelMenu()); return true; }
    state.endAt = ms;
    state.step = 'lbc_channel';
    setState(ctx.from.id, state);
    await ctx.reply(`✅ Tugash vaqti: ${formatGmt5(ms)}\n\n📢 Endi kanal username kiriting:\nMisol: @mychannel`, cancelMenu());
    return true;
  }

  if (state.step === 'lbc_channel') {
    let channel = text;
    if (!channel.startsWith('@')) channel = '@' + channel;

    let chatInfo;
    try { chatInfo = await ctx.telegram.getChat(channel); }
    catch (e) { await ctx.reply('❌ Kanal topilmadi.', cancelMenu()); return true; }

    try {
      const me = await ctx.telegram.getChatMember(channel, ctx.botInfo.id);
      if (!['administrator', 'creator'].includes(me.status)) {
        await ctx.reply('❌ Bot kanalda admin emas! Avval botni admin qiling.', cancelMenu());
        return true;
      }
    } catch (e) { await ctx.reply('❌ Bot kanalda admin emas.', cancelMenu()); return true; }

    try {
      const requester = await ctx.telegram.getChatMember(channel, ctx.from.id);
      if (!['administrator', 'creator'].includes(requester.status)) {
        await ctx.reply('❌ Siz bu kanalda admin emassiz!', cancelMenu());
        return true;
      }
    } catch (e) { await ctx.reply('❌ Siz bu kanalda admin emassiz!', cancelMenu()); return true; }

    await createLikebatlFromWizard(ctx, state, channel, chatInfo.id);
    return true;
  }

  return false;
}

async function createLikebatlFromWizard(ctx, state, channel, chatId) {
  const battleId = generateId();
  const lb = {
    battleId, owner: ctx.from.id, channel, chatId,
    participants: [],
    pointsPerReaction: state.pointsPerReaction,
    pointsPerStars: state.pointsPerStars,
    pointsPerComment: state.pointsPerComment,
    endAt: state.endAt || null,
    active: true, setupDone: true, createdAt: Date.now(),
    announceMessageId: null, messageId: null,
    battleText: state.battleText
  };
  likebatls[battleId] = lb;
  saveLikebatls();
  clearState(ctx.from.id);

  try {
    const msg = await ctx.telegram.sendMessage(
      chatId, buildLikebatlIntroPost(lb),
      { parse_mode: 'HTML', reply_markup: buildLikebatlIntroKeyboard(lb).reply_markup }
    );
    lb.messageId = msg.message_id;
    saveLikebatls();
    await ctx.reply(`✅ Like battle yaratildi va kanalga yuborildi!\n📢 ${channel}`, mainMenu());
  } catch (e) {
    delete likebatls[battleId];
    saveLikebatls();
    await ctx.reply(`❌ Kanalga post yubora olmadi:\n${e.message}`, mainMenu());
  }
}

function registerLikeBattleHandlers(bot) {
  registerReactionButtonHandler(bot);
  registerCommentButtonHandler(bot);
  registerPaidStarsWatcher(bot);
  registerLikebatlCreationWizard(bot);

  bot.hears('🥊 Mening like battlelarim', async (ctx) => {
    const user = getUser(ctx);
    if (user.banned) return ctx.reply('🚫 Siz ban qilingansiz.');
    return showMyLikebatlsMenu(bot, ctx);
  });

  bot.action(/^lbsetupmenu_(.+)$/, async (ctx) => {
    const lb = likebatls[ctx.match[1]];
    if (!lb) return ctx.answerCbQuery('❌ Topilmadi.', { show_alert: true });
    const ok = await isChannelAdminOf(bot, ctx.from.id, lb.chatId);
    if (!ok) return ctx.answerCbQuery('🚫 Faqat kanal admini.', { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.reply(buildLikebatlSetupMenu(lb), { parse_mode: 'HTML', reply_markup: buildLikebatlSetupKeyboard(lb).reply_markup });
  });

  bot.action(/^lbset_reaction_(.+)$/, async (ctx) => {
    const lb = likebatls[ctx.match[1]];
    if (!lb || lb.setupDone) return ctx.answerCbQuery('❌ Sozlama topilmadi yoki allaqachon yakunlangan.', { show_alert: true });
    const ok = await isChannelAdminOf(bot, ctx.from.id, lb.chatId);
    if (!ok) return ctx.answerCbQuery('🚫 Faqat kanal admini sozlay oladi.', { show_alert: true });
    await ctx.answerCbQuery();
    setState(ctx.from.id, { step: 'lbsetup_reaction', battleId: lb.battleId });
    await ctx.reply(`❤️ Reaksiya uchun yangi ball kiriting (hozir: ${lb.pointsPerReaction}):\n\nFaqat son yuboring (masalan: 1, 2, 5).`, cancelMenu());
  });

  bot.action(/^lbset_stars_(.+)$/, async (ctx) => {
    const lb = likebatls[ctx.match[1]];
    if (!lb || lb.setupDone) return ctx.answerCbQuery('❌ Sozlama topilmadi yoki allaqachon yakunlangan.', { show_alert: true });
    const ok = await isChannelAdminOf(bot, ctx.from.id, lb.chatId);
    if (!ok) return ctx.answerCbQuery('🚫 Faqat kanal admini sozlay oladi.', { show_alert: true });
    await ctx.answerCbQuery();
    setState(ctx.from.id, { step: 'lbsetup_stars', battleId: lb.battleId });
    await ctx.reply(`⭐ 1 Stars uchun yangi ball kiriting (hozir: ${lb.pointsPerStars}):\n\nFaqat son yuboring (masalan: 5, 10).`, cancelMenu());
  });

  bot.action(/^lbset_comment_(.+)$/, async (ctx) => {
    const lb = likebatls[ctx.match[1]];
    if (!lb || lb.setupDone) return ctx.answerCbQuery('❌ Sozlama topilmadi yoki allaqachon yakunlangan.', { show_alert: true });
    const ok = await isChannelAdminOf(bot, ctx.from.id, lb.chatId);
    if (!ok) return ctx.answerCbQuery('🚫 Faqat kanal admini sozlay oladi.', { show_alert: true });
    await ctx.answerCbQuery();
    setState(ctx.from.id, { step: 'lbsetup_comment', battleId: lb.battleId });
    await ctx.reply(`💬 Comment uchun yangi ball kiriting (hozir: ${lb.pointsPerComment}):\n\nFaqat son yuboring (masalan: 2, 3).`, cancelMenu());
  });

  bot.action(/^lbset_start_(.+)$/, async (ctx) => {
    const lb = likebatls[ctx.match[1]];
    if (!lb || lb.setupDone) return ctx.answerCbQuery('❌ Sozlama topilmadi yoki allaqachon yakunlangan.', { show_alert: true });
    const ok = await isChannelAdminOf(bot, ctx.from.id, lb.chatId);
    if (!ok) return ctx.answerCbQuery('🚫 Faqat kanal admini boshlay oladi.', { show_alert: true });

    await ctx.answerCbQuery('✅ Boshlandi!');
    lb.setupDone = true;
    lb.active = true;
    saveLikebatls();

    try { await ctx.editMessageText('✅ Sozlama yakunlandi! Battle kanalda boshlandi.'); } catch (e) {}
    try { await bot.telegram.deleteMessage(lb.chatId, lb.announceMessageId); } catch (e) {}

    try {
      const msg = await bot.telegram.sendMessage(
        lb.chatId, buildLikebatlIntroPost(lb),
        { parse_mode: 'HTML', reply_markup: buildLikebatlIntroKeyboard(lb).reply_markup }
      );
      lb.messageId = msg.message_id;
      saveLikebatls();
    } catch (e) { console.log('[LIKEBATL] live post xato:', e.message); }
  });

  bot.action(/^lbm_(.+)$/, async (ctx) => {
    const lb = likebatls[ctx.match[1]];
    if (!lb) return ctx.answerCbQuery('❌ Topilmadi.', { show_alert: true });
    const ok = lb.owner === ctx.from.id || await isChannelAdminOf(bot, ctx.from.id, lb.chatId);
    if (!ok) return ctx.answerCbQuery('🚫 Faqat kanal admini boshqara oladi.', { show_alert: true });
    await ctx.answerCbQuery();
    const text = `🥊 <b>Like Battle Boshqaruvi</b>\n\n📢 ${lb.channel}\n👥 Ishtirokchilar: ${lb.participants.length}\n❤️ ${lb.pointsPerReaction} ball / ⭐ ${lb.pointsPerStars} ball / 💬 ${lb.pointsPerComment} ball\n${lb.endAt ? `⏰ Tugash: ${formatGmt5(lb.endAt)}\n` : ''}📌 ${lb.active ? '🟢 Aktiv' : '🔴 Tugagan'}`;
    const keyboard = Markup.inlineKeyboard([
      [inlineBtn('lb_edit_reaction', '❤️ Reaksiya ballini o\'zgartirish', `lbe_reaction_${lb.battleId}`)],
      [inlineBtn('lb_edit_stars', '⭐ Stars ballini o\'zgartirish', `lbe_stars_${lb.battleId}`)],
      [inlineBtn('lb_edit_comment', '💬 Comment ballini o\'zgartirish', `lbe_comment_${lb.battleId}`)],
      [inlineBtn('lb_stats', '📊 Statistika', `lbs_${lb.battleId}`)],
      [inlineBtn('lb_stop', '🔴 Battle stop', `lbt_${lb.battleId}`)]
    ]);
    try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard.reply_markup }); }
    catch (e) { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard.reply_markup }); }
  });

  bot.action(/^lbs_(.+)$/, async (ctx) => {
    const lb = likebatls[ctx.match[1]];
    if (!lb) return ctx.answerCbQuery('❌ Battle topilmadi.', { show_alert: true });
    await ctx.answerCbQuery();

    const sorted = [...lb.participants].sort((a, b) => b.score - a.score);
    let text = `📊 <b>Battle Statistikasi</b>\n\n`;
    if (sorted.length === 0) text += 'Hali ishtirokchilar yo\'q.';
    else sorted.forEach((p, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      text += `${medal} ${p.name} — ${p.score} ball (❤️${p.reactions} ⭐${p.stars} 💬${p.comments})\n`;
    });

    try { await ctx.reply(text, { parse_mode: 'HTML' }); } catch (e) {}
  });

  bot.action(/^lbe_reaction_(.+)$/, async (ctx) => {
    const lb = likebatls[ctx.match[1]];
    if (!lb) return ctx.answerCbQuery('❌ Topilmadi.', { show_alert: true });
    const ok = lb.owner === ctx.from.id || await isChannelAdminOf(bot, ctx.from.id, lb.chatId);
    if (!ok) return ctx.answerCbQuery('🚫 Faqat kanal admini o\'zgartira oladi.', { show_alert: true });
    await ctx.answerCbQuery();
    setState(ctx.from.id, { step: 'lb_set_reaction', battleId: ctx.match[1] });
    await ctx.reply(`❤️ Reaksiya uchun yangi ball kiriting (hozir: ${lb.pointsPerReaction}):`, cancelMenu());
  });

  bot.action(/^lbe_stars_(.+)$/, async (ctx) => {
    const lb = likebatls[ctx.match[1]];
    if (!lb) return ctx.answerCbQuery('❌ Topilmadi.', { show_alert: true });
    const ok = lb.owner === ctx.from.id || await isChannelAdminOf(bot, ctx.from.id, lb.chatId);
    if (!ok) return ctx.answerCbQuery('🚫 Faqat kanal admini o\'zgartira oladi.', { show_alert: true });
    await ctx.answerCbQuery();
    setState(ctx.from.id, { step: 'lb_set_stars', battleId: ctx.match[1] });
    await ctx.reply(`⭐ 1 Stars uchun yangi ball kiriting (hozir: ${lb.pointsPerStars}):`, cancelMenu());
  });

  bot.action(/^lbe_comment_(.+)$/, async (ctx) => {
    const lb = likebatls[ctx.match[1]];
    if (!lb) return ctx.answerCbQuery('❌ Topilmadi.', { show_alert: true });
    const ok = lb.owner === ctx.from.id || await isChannelAdminOf(bot, ctx.from.id, lb.chatId);
    if (!ok) return ctx.answerCbQuery('🚫 Faqat kanal admini o\'zgartira oladi.', { show_alert: true });
    await ctx.answerCbQuery();
    setState(ctx.from.id, { step: 'lb_set_comment', battleId: ctx.match[1] });
    await ctx.reply(`💬 Comment uchun yangi ball kiriting (hozir: ${lb.pointsPerComment}):`, cancelMenu());
  });

  bot.action(/^lbt_(.+)$/, async (ctx) => {
    const lb = likebatls[ctx.match[1]];
    if (!lb) return ctx.answerCbQuery('❌ Topilmadi.', { show_alert: true });
    const ok = lb.owner === ctx.from.id || await isChannelAdminOf(bot, ctx.from.id, lb.chatId);
    if (!ok) return ctx.answerCbQuery('🚫 Faqat kanal admini to\'xtata oladi.', { show_alert: true });
    await ctx.answerCbQuery('⛔ To\'xtatildi.');
    await finishLikebatl(bot, lb);
    try { await ctx.editMessageText('⛔ Battle to\'xtatildi va natijalar kanalga yuborildi.'); } catch (e) {}
  });

  bot.command('lb', async (ctx) => {
    const liveBattles = [];
    for (const lb of Object.values(likebatls)) {
      if (lb.active && (lb.owner === ctx.from.id || await isChannelAdminOf(bot, ctx.from.id, lb.chatId))) liveBattles.push(lb);
    }
    if (liveBattles.length === 0) return ctx.reply('🥊 Aktiv like battle topilmadi.');
    const buttons = liveBattles.slice(0, 10).map(l => [
      inlineBtn('lb_manage_open', `🥊 ${l.channel} (${l.participants.length} ishtirokchi)`, `lbm_${l.battleId}`)
    ]);
    await ctx.reply('🥊 <b>Like Battle boshqaruvi</b>\n\nBoshqarish uchun battlani tanlang:', { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard(buttons).reply_markup });
  });
}

module.exports = {
  autoCreateLikebatl, handleLikebatlSetupEntry, handleLikebatlJoin,
  buildLikebatlSetupMenu, buildLikebatlSetupKeyboard,
  buildLikebatlIntroPost, buildLikebatlIntroKeyboard, updateLikebatlIntroPost,
  recalcScore, registerLikeBattleHandlers, handleCommentTextState,
  handleLikebatlCreationTextState, finishLikebatl
};
