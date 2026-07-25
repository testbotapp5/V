const { Markup } = require('telegraf');
const { BOT_USERNAME } = require('../config');
const { contests, users, settings, saveContests, saveUsers } = require('../db');
const {
  generateId, getUser, bumpActivity, isMemberOf, checkRequiredChannels,
  isChannelAdminOf, botIsAdminOf, requireCaptchaThen, parseGmt5DateTime, formatGmt5,
  filterChatsWhereUserIsAdmin
} = require('../helpers');
const { setState, getState, clearState } = require('../state');
const { mainMenu, cancelMenu } = require('../keyboards');
const { registerButton, inlineBtn, inlineUrlBtn } = require('../buttons');

// ── TUGMALARNI RO'YXATDAN O'TKAZISH ──
registerButton('rc_join',            '🟢 Qatnashish (#random)', 'success');
registerButton('rc_subscribe',       '📢 Kanalga obuna bo\'lish', 'primary');
registerButton('rc_manage_open',     '🎲 Konkurs boshqaruvi (ochish)', 'primary');
registerButton('rc_participants',    '👥 Qatnashganlar', 'primary');
registerButton('rc_finish',          '🔴 Yakunlash (g\'olib tanlash)', 'danger');
registerButton('rc_back',            '◀️ Orqaga', 'primary');
registerButton('rc_win_count',       '🏆 G\'oliblar soni (raqam)', 'primary');
registerButton('rc_publish_now',     '🟢 Hoziroq e\'lon qilish', 'success');
registerButton('rc_publish_later',   '🔵 Belgilangan vaqtda e\'lon qilish', 'primary');
registerButton('rc_end_by_count',    '👥 Odam soniga qarab tugatish', 'primary');
registerButton('rc_end_by_time',     '⏰ Vaqtga qarab tugatish', 'primary');
registerButton('rc_stop_pick',       '🎲 Konkurs tanlash (stop)', 'primary');

function getContestsByOwner(ownerId) {
  return Object.values(contests).filter(c => c.owner === ownerId);
}

// Foydalanuvchiga tegishli BARCHA random konkurslar: o'zi botda yaratganlari
// VA hozir admin bo'lgan kanallarda #random orqali avto-yaratilganlari.
async function getContestsVisibleToUser(bot, userId) {
  const personal = Object.values(contests).filter(c => c.owner === userId);
  const autoCreated = Object.values(contests).filter(c => c.owner === 0);
  if (autoCreated.length === 0) return personal;

  const adminChatIds = await filterChatsWhereUserIsAdmin(bot, userId, autoCreated.map(c => c.chatId));
  const visibleAuto = autoCreated.filter(c => adminChatIds.has(String(c.chatId)));
  return [...personal, ...visibleAuto];
}

async function canManageContest(bot, ctx, contest) {
  if (!contest) return false;
  if (contest.owner === ctx.from.id) return true;
  return await isChannelAdminOf(bot, ctx.from.id, contest.chatId);
}

// Kutilgan kanal-hashtag format:
// #random
// salom yangi konkurs boshlandik
// yutuq nft emas
// shartlari
// @kanal
// #soni 10        -> qatnashchilar maqsadi (ixtiyoriy, auto-stop uchun)
// #win 2           -> nechta g'olib tanlanadi
// #vaqt 26.06.28 20:00  -> GMT+5 bo'yicha tugash vaqti (ixtiyoriy)
function parseRandomHashtag(rawText) {
  const winMatch  = rawText.match(/#win\s+(\d+)/i);
  const soniMatch = rawText.match(/#soni\s+(\d+)/i);
  const timeMatch = rawText.match(/#vaqt\s+(\d{2}\.\d{2}\.\d{2}\s+\d{1,2}:\d{2})/i);

  let endAt = null;
  if (timeMatch) endAt = parseGmt5DateTime(timeMatch[1]);

  const body = rawText
    .replace(/^#random\s*/i, '')
    .replace(/#win\s+\d+/i, '')
    .replace(/#soni\s+\d+/i, '')
    .replace(/#vaqt\s+\d{2}\.\d{2}\.\d{2}\s+\d{1,2}:\d{2}/i, '')
    .trim();

  return {
    body: body || 'Random konkurs boshlandi!',
    winCount: winMatch ? Math.max(1, parseInt(winMatch[1], 10)) : 1,
    targetParticipants: soniMatch ? Math.max(1, parseInt(soniMatch[1], 10)) : 0,
    endAt
  };
}

function buildRandomPost(contest) {
  let text = `🎲 <b>RANDOM KONKURS!</b>\n\n`;
  text += `${contest.text}\n\n`;
  text += `🏆 <b>G'oliblar soni:</b> ${contest.winCount}\n`;
  if (contest.targetParticipants) text += `🎯 <b>Maqsad:</b> ${contest.targetParticipants} qatnashchi\n`;
  if (contest.endAt) text += `⏰ <b>Tugash vaqti:</b> ${formatGmt5(contest.endAt)}\n`;
  text += `👥 <b>Qatnashganlar:</b> ${contest.participants.length}\n\n`;
  text += `👇 Qatnashish uchun tugmani bosing`;
  return text;
}

function buildRandomKeyboard(contest) {
  return Markup.inlineKeyboard([
    [inlineUrlBtn(
      'rc_join',
      `🟢 Qatnashish (${contest.participants.length})`,
      `https://t.me/${BOT_USERNAME}?start=rjoin-${contest.contestId}`
    )]
  ]);
}

async function updateRandomPost(bot, contest) {
  if (!contest.messageId || !contest.chatId) return;
  try {
    await bot.telegram.editMessageText(
      contest.chatId, contest.messageId, null,
      buildRandomPost(contest),
      { parse_mode: 'HTML', reply_markup: buildRandomKeyboard(contest).reply_markup }
    );
  } catch (e) {
    console.log('[RANDOM] edit xato:', e.message);
  }
}

async function pickRandomWinners(contest) {
  const pool = [...contest.participants];
  const winners = [];
  const n = Math.min(contest.winCount, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    winners.push(pool.splice(idx, 1)[0]);
  }
  return winners;
}

async function finishRandomContest(bot, contest) {
  contest.active = false;
  contest.finishedAt = Date.now();
  saveContests();
  const winners = await pickRandomWinners(contest);
  contest.winners = winners;
  saveContests();

  let text = `🎉 <b>RANDOM KONKURS TUGADI!</b>\n\n${contest.text}\n\n🏆 <b>G'oliblar:</b>\n\n`;
  if (winners.length === 0) {
    text += 'Qatnashchilar bo\'lmadi.';
  } else {
    for (const uid of winners) {
      const u = users[String(uid)];
      text += `🎁 ${u && u.username ? '@' + u.username : 'ID: ' + uid}\n`;
    }
  }

  try {
    await bot.telegram.sendMessage(contest.chatId, text, { parse_mode: 'HTML' });
  } catch (e) { console.log('[RANDOM] natija xato:', e.message); }

  if (contest.owner) {
    try { await bot.telegram.sendMessage(contest.owner, `🎲 Random konkursingiz tugadi va g'oliblar e'lon qilindi!`); } catch (e) {}
  }
}

async function autoCreateRandomContest(bot, chatId, channelUsername, rawText) {
  if (!(await botIsAdminOf(bot, chatId))) return;

  const { body, winCount, targetParticipants, endAt } = parseRandomHashtag(rawText);
  const contestId = generateId();
  const contest = {
    contestId, type: 'random', owner: 0,
    channel: channelUsername, chatId,
    text: body, winCount, targetParticipants, endAt: endAt || null,
    participants: [], winners: [], active: true,
    createdAt: Date.now(), messageId: null
  };
  contests[contestId] = contest;
  saveContests();

  try {
    const msg = await bot.telegram.sendMessage(
      chatId, buildRandomPost(contest),
      { parse_mode: 'HTML', reply_markup: buildRandomKeyboard(contest).reply_markup }
    );
    contest.messageId = msg.message_id;
    saveContests();
  } catch (e) {
    console.log('[AUTO-RANDOM] xato:', e.message);
    delete contests[contestId];
    saveContests();
  }
}

// ============================================================
//                RANDOM JOIN HANDLER (#random) — BOTDA
// ============================================================
async function handleRandomJoin(bot, ctx, contestId) {
  const user = getUser(ctx);
  if (user.banned) return ctx.reply('🚫 Siz ban qilingansiz.');

  const contest = contests[contestId];
  if (!contest) return ctx.reply('❌ Konkurs topilmadi.');
  if (!contest.active) return ctx.reply('❌ Konkurs tugagan.');

  const uid = ctx.from.id;
  if (contest.participants.includes(uid)) {
    return ctx.reply('✅ Siz allaqachon qatnashgansiz!');
  }

  const inChannel = await isMemberOf(bot, uid, contest.channel);
  if (!inChannel) {
    const channelLink = `https://t.me/${contest.channel.replace('@', '')}`;
    return ctx.reply(
      `❌ Qatnashish uchun avval ${contest.channel} kanaliga obuna bo'ling, so'ng qaytadan urinib ko'ring!`,
      Markup.inlineKeyboard([[inlineUrlBtn('rc_subscribe', `📢 ${contest.channel} ga obuna bo'lish`, channelLink)]])
    );
  }

  const reqOk = await checkRequiredChannels(bot, uid);
  if (!reqOk) {
    const buttons = settings.requiredChannels.map(ch => [
      inlineUrlBtn('rc_subscribe', `📢 ${ch}`, `https://t.me/${ch.replace('@', '')}`)
    ]);
    return ctx.reply('❌ Majburiy kanallarga obuna bo\'ling, so\'ng qaytadan urinib ko\'ring:', Markup.inlineKeyboard(buttons));
  }

  if (settings.captchaOnJoin) {
    return requireCaptchaThen(ctx, cancelMenu, async () => finalizeRandomJoin(bot, ctx, contest));
  }
  return finalizeRandomJoin(bot, ctx, contest);
}

async function finalizeRandomJoin(bot, ctx, contest) {
  const uid = ctx.from.id;
  contest.participants.push(uid);
  saveContests();

  const suid = String(uid);
  if (!users[suid]) getUser(ctx);
  users[suid].randomJoined = (users[suid].randomJoined || 0) + 1;
  saveUsers();
  bumpActivity(uid, 2);

  await updateRandomPost(bot, contest);
  await ctx.reply('✅ Siz random konkursga muvaffaqiyatli qo\'shildingiz! Omad tilaymiz 🍀', mainMenu());

  if (contest.targetParticipants > 0 && contest.participants.length >= contest.targetParticipants) {
    await finishRandomContest(bot, contest);
  }
}

// ============================================================
//        "MENING KONKURSLARIM" MENYUSI
// ============================================================
function contestListButtons(mine) {
  const active   = mine.filter(c => c.active);
  const finished = mine.filter(c => !c.active);
  const buttons  = [];
  active.forEach(c => buttons.push([inlineBtn('rc_manage_open', `🟢 ${c.text.substring(0, 20)} (${c.participants.length})`, `rm_${c.contestId}`)]));
  finished.slice(0, 8).forEach(c => buttons.push([inlineBtn('rc_manage_open', `🔴 ${c.text.substring(0, 20)}`, `ri_${c.contestId}`)]));
  return { active, finished, buttons };
}

async function showMyContestsMenu(bot, ctx) {
  const mine = await getContestsVisibleToUser(bot, ctx.from.id);
  if (mine.length === 0) {
    return ctx.reply(
      '🎲 Sizda hali random konkurs yo\'q.\n\n"➕ Konkurs yaratish" tugmasi orqali botda yarating, yoki admin bo\'lgan kanalingizda <code>#random</code> yozing.',
      { parse_mode: 'HTML', ...mainMenu() }
    );
  }
  const { active, finished, buttons } = contestListButtons(mine);
  await ctx.reply(`🎲 <b>Mening konkurslarim</b>\n\n🟢 Aktiv: ${active.length}\n🔴 Tugagan: ${finished.length}`, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
}

// ============================================================
//   BOTDA KONKURS YARATISH WIZARD
//   1) matn  2) win soni  3) qachon publish (hozir/vaqt bilan)
//   4) qanday tugatilsin (odam soniga qarab / vaqtga qarab)  5) kanal
// ============================================================
function registerRandomCreationWizard(bot) {
  bot.hears('➕ Konkurs yaratish', async (ctx) => {
    const user = getUser(ctx);
    if (user.banned) return ctx.reply('🚫 Siz ban qilingansiz.');
    setState(ctx.from.id, { step: 'rc_text' });
    await ctx.reply(
      '🎲 <b>Random konkurs yaratish</b>\n\n📝 Konkurs matnini kiriting (faqat shu matn postga chiqadi):',
      { parse_mode: 'HTML', ...cancelMenu() }
    );
  });

  bot.action(/^rc_win_(\d+)$/, async (ctx) => {
    const state = getState(ctx.from.id);
    if (!state || state.step !== 'rc_winselect') return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    state.winCount = parseInt(ctx.match[1], 10);
    state.step = 'rc_publish_choice';
    setState(ctx.from.id, state);
    try { await ctx.editMessageText(`✅ G'oliblar soni: ${state.winCount}`); } catch (e) {}
    await ctx.reply(
      '📅 Konkurs qachon e\'lon qilinsin?',
      Markup.inlineKeyboard([
        [inlineBtn('rc_publish_now', '🟢 Hoziroq', 'rc_publish_now')],
        [inlineBtn('rc_publish_later', '🔵 Belgilangan vaqtda', 'rc_publish_later')]
      ])
    );
  });

  bot.action('rc_publish_now', async (ctx) => {
    const state = getState(ctx.from.id);
    if (!state || state.step !== 'rc_publish_choice') return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    state.publishAt = null;
    state.step = 'rc_end_choice';
    setState(ctx.from.id, state);
    try { await ctx.editMessageText('✅ Hoziroq e\'lon qilinadi.'); } catch (e) {}
    await ctx.reply(
      '🏁 Konkurs qanday tugatilsin?',
      Markup.inlineKeyboard([
        [inlineBtn('rc_end_by_count', '👥 Odam soniga qarab', 'rc_end_count')],
        [inlineBtn('rc_end_by_time', '⏰ Vaqtga qarab', 'rc_end_time')]
      ])
    );
  });

  bot.action('rc_publish_later', async (ctx) => {
    const state = getState(ctx.from.id);
    if (!state || state.step !== 'rc_publish_choice') return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    state.step = 'rc_publish_time_input';
    setState(ctx.from.id, state);
    try { await ctx.editMessageText('⏰ E\'lon qilinish vaqtini kiriting (GMT+5):'); } catch (e) {}
    await ctx.reply('Format: <code>KK.OO.YY SS:DD</code>\nMisol: <code>26.06.28 20:00</code>', { parse_mode: 'HTML', ...cancelMenu() });
  });

  bot.action('rc_end_count', async (ctx) => {
    const state = getState(ctx.from.id);
    if (!state || state.step !== 'rc_end_choice') return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    state.endMode = 'count';
    state.step = 'rc_end_count_input';
    setState(ctx.from.id, state);
    try { await ctx.editMessageText('👥 Odam soniga qarab tugatish tanlandi.'); } catch (e) {}
    await ctx.reply('🎯 Nechta odam qatnashganda konkurs avto tugasin? (son kiriting)', cancelMenu());
  });

  bot.action('rc_end_time', async (ctx) => {
    const state = getState(ctx.from.id);
    if (!state || state.step !== 'rc_end_choice') return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    state.endMode = 'time';
    state.step = 'rc_end_time_input';
    setState(ctx.from.id, state);
    try { await ctx.editMessageText('⏰ Vaqtga qarab tugatish tanlandi.'); } catch (e) {}
    await ctx.reply('Tugash vaqtini kiriting (GMT+5):\nFormat: <code>KK.OO.YY SS:DD</code>\nMisol: <code>26.06.28 20:00</code>', { parse_mode: 'HTML', ...cancelMenu() });
  });
}

// Matnli holatlarni qabul qiladi — markaziy text handlerdan chaqiriladi.
// true qaytarsa — holat shu yerda to'liq qayta ishlangan deb hisoblanadi.
async function handleRandomCreationTextState(bot, ctx, state) {
  const text = ctx.message.text.trim();

  if (state.step === 'rc_text') {
    state.contestText = text;
    state.step = 'rc_winselect';
    setState(ctx.from.id, state);
    await ctx.reply(
      '🏆 Nechta g\'olib bo\'lsin?',
      Markup.inlineKeyboard([
        [inlineBtn('rc_win_count', '1', 'rc_win_1'), inlineBtn('rc_win_count', '2', 'rc_win_2'), inlineBtn('rc_win_count', '3', 'rc_win_3')],
        [inlineBtn('rc_win_count', '5', 'rc_win_5'), inlineBtn('rc_win_count', '10', 'rc_win_10')]
      ])
    );
    return true;
  }

  if (state.step === 'rc_publish_time_input') {
    const ms = parseGmt5DateTime(text);
    if (!ms) { await ctx.reply('❌ Format noto\'g\'ri. Misol: 26.06.28 20:00', cancelMenu()); return true; }
    if (ms <= Date.now()) { await ctx.reply('❌ Bu vaqt allaqachon o\'tib ketgan. Kelajakdagi vaqt kiriting.', cancelMenu()); return true; }
    state.publishAt = ms;
    state.step = 'rc_end_choice';
    setState(ctx.from.id, state);
    await ctx.reply(`✅ E'lon qilinish vaqti: ${formatGmt5(ms)}`, mainMenu());
    await ctx.reply(
      '🏁 Konkurs qanday tugatilsin?',
      Markup.inlineKeyboard([
        [inlineBtn('rc_end_by_count', '👥 Odam soniga qarab', 'rc_end_count')],
        [inlineBtn('rc_end_by_time', '⏰ Vaqtga qarab', 'rc_end_time')]
      ])
    );
    return true;
  }

  if (state.step === 'rc_end_count_input') {
    const n = parseInt(text, 10);
    if (isNaN(n) || n < 1) { await ctx.reply('❌ To\'g\'ri son kiriting.', cancelMenu()); return true; }
    state.targetParticipants = n;
    state.endAt = null;
    state.step = 'rc_channel';
    setState(ctx.from.id, state);
    await ctx.reply(`✅ Maqsad: ${n} qatnashchi\n\n📢 Endi kanal username kiriting:\nMisol: @mychannel`, cancelMenu());
    return true;
  }

  if (state.step === 'rc_end_time_input') {
    const ms = parseGmt5DateTime(text);
    if (!ms) { await ctx.reply('❌ Format noto\'g\'ri. Misol: 26.06.28 20:00', cancelMenu()); return true; }
    if (ms <= Date.now()) { await ctx.reply('❌ Bu vaqt allaqachon o\'tib ketgan.', cancelMenu()); return true; }
    state.endAt = ms;
    state.targetParticipants = 0;
    state.step = 'rc_channel';
    setState(ctx.from.id, state);
    await ctx.reply(`✅ Tugash vaqti: ${formatGmt5(ms)}\n\n📢 Endi kanal username kiriting:\nMisol: @mychannel`, cancelMenu());
    return true;
  }

  if (state.step === 'rc_channel') {
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

    await createContestFromWizard(ctx, state, channel, chatInfo.id);
    return true;
  }

  return false;
}

async function createContestFromWizard(ctx, state, channel, chatId) {
  const contestId = generateId();
  const contest = {
    contestId, type: 'random', owner: ctx.from.id,
    channel, chatId,
    text: state.contestText, winCount: state.winCount || 1,
    targetParticipants: state.targetParticipants || 0,
    endAt: state.endAt || null,
    publishAt: state.publishAt || null,
    participants: [], winners: [],
    active: !state.publishAt, // agar kelajakda e'lon qilinsa, hozircha active=false (cron publish qiladi)
    pendingPublish: !!state.publishAt,
    createdAt: Date.now(), messageId: null
  };
  contests[contestId] = contest;
  saveContests();
  clearState(ctx.from.id);

  if (contest.pendingPublish) {
    await ctx.reply(
      `✅ Konkurs saqlandi! ${formatGmt5(contest.publishAt)}da avtomatik e'lon qilinadi.\n📢 Kanal: ${channel}`,
      mainMenu()
    );
    return;
  }

  await publishContestNow(ctx.telegram, contest);
  await ctx.reply(`✅ Konkurs yaratildi va kanalga yuborildi!\n📢 ${channel}`, mainMenu());
}

async function publishContestNow(telegram, contest) {
  contest.active = true;
  contest.pendingPublish = false;
  saveContests();
  try {
    const msg = await telegram.sendMessage(
      contest.chatId, buildRandomPost(contest),
      { parse_mode: 'HTML', reply_markup: buildRandomKeyboard(contest).reply_markup }
    );
    contest.messageId = msg.message_id;
    saveContests();
  } catch (e) {
    console.log('[RANDOM] publishContestNow xato:', e.message);
  }
}

function registerRandomContestHandlers(bot) {
  registerRandomCreationWizard(bot);

  bot.hears('🎲 Mening konkurslarim', async (ctx) => {
    const user = getUser(ctx);
    if (user.banned) return ctx.reply('🚫 Siz ban qilingansiz.');
    return showMyContestsMenu(bot, ctx);
  });

  bot.action(/^rm_(.+)$/, async (ctx) => {
    const contest = contests[ctx.match[1]];
    if (!(await canManageContest(bot, ctx, contest))) return ctx.answerCbQuery('🚫 Sizda ruxsat yo\'q.', { show_alert: true });
    await ctx.answerCbQuery();

    let text = `🎲 <b>Konkurs Boshqaruvi</b>\n\n${contest.text}\n\n🏆 G'oliblar: ${contest.winCount}\n`;
    if (contest.targetParticipants) text += `🎯 Maqsad: ${contest.targetParticipants} qatnashchi\n`;
    if (contest.endAt) text += `⏰ Tugash: ${formatGmt5(contest.endAt)}\n`;
    text += `👥 Qatnashganlar: ${contest.participants.length}\n📌 ${contest.active ? '🟢 Aktiv' : '🔴 Tugagan'}`;

    const rows = [[inlineBtn('rc_participants', '👥 Qatnashganlar', `rp_${contest.contestId}`)]];
    if (contest.active) rows.push([inlineBtn('rc_finish', '🔴 Yakunlash (g\'olib tanlash)', `rstop_${contest.contestId}`)]);
    rows.push([inlineBtn('rc_back', '◀️ Orqaga', 'back_contests')]);

    try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard(rows).reply_markup }); }
    catch (e) { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard(rows).reply_markup }); }
  });

  bot.action(/^rp_(.+)$/, async (ctx) => {
    const contest = contests[ctx.match[1]];
    if (!(await canManageContest(bot, ctx, contest))) return ctx.answerCbQuery('🚫 Sizda ruxsat yo\'q.', { show_alert: true });
    await ctx.answerCbQuery();
    let text = `👥 <b>Qatnashganlar</b> (${contest.participants.length})\n\n`;
    text += contest.participants.length
      ? contest.participants.map((uid, i) => { const u = users[String(uid)]; return `${i + 1}. ${u && u.username ? '@' + u.username : 'ID:' + uid}`; }).join('\n')
      : 'Hali qatnashchilar yo\'q.';
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([[inlineBtn('rc_back', '◀️ Orqaga', `rm_${contest.contestId}`)]]).reply_markup });
  });

  bot.action(/^ri_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const contest = contests[ctx.match[1]];
    if (!contest) return;
    let text = `📊 <b>Yakunlangan konkurs</b>\n\n${contest.text}\n\n👥 Qatnashganlar: ${contest.participants.length}\n🏆 G'oliblar:\n`;
    text += (contest.winners || []).length
      ? contest.winners.map(uid => { const u = users[String(uid)]; return u && u.username ? '@' + u.username : 'ID:' + uid; }).join('\n')
      : 'Yo\'q.';
    await ctx.reply(text, { parse_mode: 'HTML' });
  });

  bot.action('back_contests', async (ctx) => {
    await ctx.answerCbQuery();
    const mine = await getContestsVisibleToUser(bot, ctx.from.id);
    const { active, finished, buttons } = contestListButtons(mine);
    try { await ctx.editMessageText(`🎲 <b>Mening konkurslarim</b>\n\n🟢 Aktiv: ${active.length}\n🔴 Tugagan: ${finished.length}`, { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard(buttons).reply_markup }); } catch (e) {}
  });

  bot.command('stoprandom', async (ctx) => {
    const active = Object.values(contests).filter(c => c.active && c.type === 'random');
    if (active.length === 0) return ctx.reply('🎲 Aktiv random konkurs topilmadi.');
    const buttons = active.slice(0, 10).map(c => [
      inlineBtn('rc_stop_pick', `🎲 ${c.channel} (${c.participants.length} ishtirokchi)`, `rstop_${c.contestId}`)
    ]);
    await ctx.reply('🎲 To\'xtatish uchun random konkursni tanlang:', Markup.inlineKeyboard(buttons));
  });

  bot.action(/^rstop_(.+)$/, async (ctx) => {
    const contest = contests[ctx.match[1]];
    if (!contest) return ctx.answerCbQuery('❌ Topilmadi.', { show_alert: true });
    if (!(await canManageContest(bot, ctx, contest))) return ctx.answerCbQuery('🚫 Faqat kanal admini yoki yaratuvchi to\'xtata oladi.', { show_alert: true });
    await ctx.answerCbQuery('🎲 Yakunlanmoqda...');
    await finishRandomContest(bot, contest);
    try { await ctx.editMessageText('✅ Random konkurs yakunlandi va g\'oliblar e\'lon qilindi.'); } catch (e) {}
  });
}

module.exports = {
  parseRandomHashtag, buildRandomPost, buildRandomKeyboard, updateRandomPost,
  finishRandomContest, autoCreateRandomContest, publishContestNow,
  handleRandomJoin, finalizeRandomJoin,
  getContestsByOwner, getContestsVisibleToUser,
  registerRandomContestHandlers, handleRandomCreationTextState
};
