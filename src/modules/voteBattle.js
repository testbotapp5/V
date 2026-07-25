const { Markup } = require('telegraf');
const { BOT_USERNAME } = require('../config');
const { battles, users, settings, templates, saveBattles, saveUsers, saveTemplates } = require('../db');
const {
  generateId, getUser, bumpActivity, isMemberOf, checkRequiredChannels,
  isChannelAdminOf, botIsAdminOf, requireCaptchaThen, parseGmt5DateTime, formatGmt5
} = require('../helpers');
const { setState, getState, clearState } = require('../state');
const { mainMenu, cancelMenu } = require('../keyboards');
const { registerButton, inlineBtn, inlineUrlBtn } = require('../buttons');

// ── TUGMALARNI RO'YXATDAN O'TKAZISH (rang/emoji sozlash uchun) ──
registerButton('vb_join',           '➕ Konkursga qo\'shilish', 'success');
registerButton('vb_results',        '📊 Natijalar', 'danger');
registerButton('vb_participant',    '👤 Ishtirokchi (reyting qatori)', 'primary');
registerButton('vb_subscribe',      '📢 Kanalga obuna bo\'lish', 'primary');
registerButton('vb_manage_open',    '📋 Battle boshqaruvi (ochish)', 'primary');
registerButton('vb_participants',   '👥 Ishtirokchilar', 'primary');
registerButton('vb_voters',         '🗳 Ovoz berganlar', 'primary');
registerButton('vb_results_panel',  '📊 Natijalar (panel)', 'primary');
registerButton('vb_change_target',  '🎯 Maqsadni o\'zgartirish', 'primary');
registerButton('vb_stop',           '🔴 Battle stop', 'danger');
registerButton('vb_refresh',        '🔄 Yangilash', 'primary');
registerButton('vb_back',           '◀️ Orqaga', 'primary');
registerButton('vb_stopboshla_pick','🏆 Avto-battle tanlash', 'primary');
registerButton('vb_use_template',   '🗂 Shablondan foydalanish', 'primary');
registerButton('vb_new_manual',     '✏️ Qo\'lda yaratish', 'primary');
registerButton('vb_template_pick',  '🗂 Shablon tanlash (ro\'yxat)', 'primary');
registerButton('vb_save_template',  '💾 Shablon sifatida saqlash', 'success');
registerButton('vb_skip_template',  '➡️ Saqlamasdan o\'tish', 'primary');

// ============================================================
//   IDENTIFIKATSIYA: userId asosida (username o'zgarsa ham ishlaydi).
//   participants: [{ userId, username }]
//   votes: { [voterId]: { targetUserId, username, votedAt } }
//   Eski (faqat username saqlangan) ma'lumotlar bo'lsa ham xato bermasin
//   deb yordamchi funksiyalar moslashuvchan yozilgan.
// ============================================================

function getVotesForParticipant(battle, userId) {
  const uid = String(userId);
  return Object.values(battle.votes).filter(v => String(v.targetUserId) === uid).length;
}

function findParticipant(battle, userId) {
  const uid = String(userId);
  return battle.participants.find(p => String(p.userId) === uid);
}

// Sovrin matni: agar kiritilmagan/bo'sh bo'lsa "sir" deb ko'rsatiladi
function prizeText(battle) {
  return battle.text && battle.text.trim() ? battle.text : 'Hozircha sir🤫';
}

function displayName(p) {
  return p.username ? `@${p.username}` : `ID:${p.userId}`;
}

function getBattlesByOwner(ownerId) {
  return Object.values(battles).filter(b => b.owner === ownerId);
}

// Foydalanuvchiga tegishli BARCHA battlelar: o'zi shaxsan yaratganlari (owner=user)
// VA hozir admin bo'lgan kanallarda avto-yaratilganlari (owner=0, #boshla orqali).
async function getBattlesVisibleToUser(bot, userId) {
  const personal = Object.values(battles).filter(b => b.owner === userId);
  const autoCreated = Object.values(battles).filter(b => b.owner === 0);

  if (autoCreated.length === 0) return personal;

  const { filterChatsWhereUserIsAdmin } = require('../helpers');
  const adminChatIds = await filterChatsWhereUserIsAdmin(bot, userId, autoCreated.map(b => b.chatId));
  const visibleAuto = autoCreated.filter(b => adminChatIds.has(String(b.chatId)));

  return [...personal, ...visibleAuto];
}

function buildBattlePost(battle) {
  const tpl = settings.boshlaTemplate;
  const sorted = battle.participants
    .map(p => ({ ...p, count: getVotesForParticipant(battle, p.userId) }))
    .sort((a, b) => b.count - a.count);

  let text = `${tpl.header}\n\n`;
  text += `❗️Konkurs shartlari shu kanalga obuna bo'lish va do'stlaringiz sizga ovoz berishini so'rashdan iborat.\n`;
  text += ` Agar kanalga qo'shilib ovoz berib chiqib ketsa ovozi avto atmen boladi⛔️\n\n`;
  text += `🎁Konkursga qo'yilgan yutuqlar: ${prizeText(battle)}\n\n`;
  if (battle.target) text += `🎯 <b>Maqsad:</b> ${battle.target} ta ovoz\n`;
  if (battle.endAt)  text += `⏰ <b>Tugash vaqti:</b> ${formatGmt5(battle.endAt)}\n`;
  text += `\n➕ Konkursga qo'shilish uchun quyidagi tugmani bosing👇\n`;
  text += `\n📈 <b>Reyting:</b>\n\n`;

  if (sorted.length === 0) {
    text += `Hali ishtirokchilar yo'q\n`;
  } else {
    sorted.forEach((p, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      text += `${medal} ${displayName(p)} — ${p.count} 📦\n`;
    });
  }
  if (tpl.footer) text += `\n${tpl.footer}`;
  return text;
}

function buildBattleKeyboard(battle) {
  const sorted = battle.participants
    .map(p => ({ ...p, count: getVotesForParticipant(battle, p.userId) }))
    .sort((a, b) => b.count - a.count);

  const buttons = [];
  sorted.forEach(p => {
    buttons.push([inlineUrlBtn(
      'vb_participant',
      `${displayName(p)} — ${p.count} 📦`,
      `https://t.me/${BOT_USERNAME}?start=vote-${battle.battleId}-${p.userId}`
    )]);
  });

  buttons.push([inlineUrlBtn(
    'vb_join', '➕ KONKURSGA QO\'SHILISH',
    `https://t.me/${BOT_USERNAME}?start=join-${battle.battleId}`
  )]);
  buttons.push([inlineUrlBtn(
    'vb_results', '📊 NATIJALAR',
    `https://t.me/${BOT_USERNAME}?start=results-${battle.battleId}`
  )]);

  return Markup.inlineKeyboard(buttons);
}

async function updateBattlePost(bot, battle) {
  if (!battle.messageId || !battle.chatId) return;
  try {
    await bot.telegram.editMessageText(
      battle.chatId, battle.messageId, null,
      buildBattlePost(battle),
      { parse_mode: 'HTML', reply_markup: buildBattleKeyboard(battle).reply_markup }
    );
  } catch (e) {
    console.log('[BOSHLA] post edit xato:', e.message);
  }
}

async function declareWinner(bot, battle, winnerUserId) {
  battle.active = false;
  battle.finishedAt = Date.now();
  const winnerP = findParticipant(battle, winnerUserId);
  battle.winner = winnerUserId;
  saveBattles();

  const winnerUid = String(winnerUserId);
  if (users[winnerUid]) {
    users[winnerUid].wins = (users[winnerUid].wins || 0) + 1;
    saveUsers();
  }

  battle.participants.forEach(p => {
    if (String(p.userId) !== winnerUid && users[String(p.userId)]) {
      users[String(p.userId)].loses = (users[String(p.userId)].loses || 0) + 1;
    }
  });
  saveUsers();

  const winnerLabel = winnerP ? displayName(winnerP) : `ID:${winnerUserId}`;

  try {
    await bot.telegram.sendMessage(
      battle.chatId,
      `🏆 <b>BATTLE TUGADI</b>\n\n🥇 <b>G'olib:</b> ${winnerLabel}\n\n🎉 <b>Tabriklaymiz!</b>\n🎁 Sovrin: ${prizeText(battle)}`,
      { parse_mode: 'HTML' }
    );
  } catch (e) { console.log('[BOSHLA] g\'olib e\'loni xato:', e.message); }

  if (battle.owner) {
    try {
      await bot.telegram.sendMessage(
        battle.owner,
        `🏆 Battleingiz tugadi!\n\n🥇 G'olib: ${winnerLabel}\n🎁 Sovrin: ${prizeText(battle)}`,
        { parse_mode: 'HTML' }
      );
    } catch (e) {}
  }
}

async function stopBattleNoWinner(bot, battle, reasonText) {
  battle.active = false;
  battle.finishedAt = Date.now();
  saveBattles();
  try {
    await bot.telegram.sendMessage(battle.chatId, reasonText, { parse_mode: 'HTML' });
  } catch (e) {}
}

function parseBoshlaHashtag(rawText) {
  const targetMatch = rawText.match(/#soni\s+(\d+)/i);
  const timeMatch   = rawText.match(/#vaqt\s+(\d{2}\.\d{2}\.\d{2}\s+\d{1,2}:\d{2})/i);

  let endAt = null;
  if (timeMatch) {
    endAt = parseGmt5DateTime(timeMatch[1]);
  }

  const body = rawText
    .replace(/^#boshla\s*/i, '')
    .replace(/#soni\s+\d+/i, '')
    .replace(/#vaqt\s+\d{2}\.\d{2}\.\d{2}\s+\d{1,2}:\d{2}/i, '')
    .trim(); // bo'sh qolsa — sovrin "sir" deb ko'rsatiladi (buildBattlePost)

  return {
    body,
    target: targetMatch ? Math.max(1, parseInt(targetMatch[1], 10)) : 0, // 0 = maqsadsiz (faqat vaqt bilan tugaydi)
    endAt
  };
}

async function autoCreateBoshlaBattle(bot, chatId, channelUsername, rawText) {
  if (!(await botIsAdminOf(bot, chatId))) return;

  const { body, target, endAt } = parseBoshlaHashtag(rawText);

  const battleId = generateId();
  const battle = {
    battleId, owner: 0, channel: channelUsername, chatId,
    text: body, target: target || 0, endAt: endAt || null,
    active: true, participants: [], votes: {}, // votes[voterId] = { targetUserId, username, votedAt }
    messageId: null, createdAt: Date.now()
  };
  battles[battleId] = battle;
  saveBattles();

  try {
    const msg = await bot.telegram.sendMessage(
      chatId, buildBattlePost(battle),
      { parse_mode: 'HTML', reply_markup: buildBattleKeyboard(battle).reply_markup }
    );
    battle.messageId = msg.message_id;
    saveBattles();
  } catch (e) {
    console.log('[AUTO-BOSHLA] xato:', e.message);
    delete battles[battleId];
    saveBattles();
  }
}

// ============================================================
//                   VOTE / JOIN / RESULTS (botda)
// ============================================================
async function handleVote(bot, ctx, battleId, targetUserIdRaw) {
  const voter = getUser(ctx);
  if (voter.banned) return ctx.reply('🚫 Siz ban qilingansiz.');

  const battle = battles[battleId];
  if (!battle || !battle.active) return ctx.reply('❌ Aktiv battle topilmadi yoki battle tugagan.');

  const targetUserId = String(targetUserIdRaw);
  const voterId = String(ctx.from.id);

  if (voterId === targetUserId) {
    return ctx.reply('❌ O\'zingizga ovoz bera olmaysiz.');
  }

  const target = findParticipant(battle, targetUserId);
  if (!target) return ctx.reply('❌ Bu ishtirokchi battleda yo\'q.');

  if (battle.votes[voterId]) {
    const prev = battle.votes[voterId];
    if (String(prev.targetUserId) === targetUserId) {
      return ctx.reply(`❌ Siz allaqachon ${displayName(target)}ga ovoz bergansiz.`);
    }
    const prevP = findParticipant(battle, prev.targetUserId);
    return ctx.reply(`❌ Siz bu battleda allaqachon ${prevP ? displayName(prevP) : 'boshqa ishtirokchi'}ga ovoz bergansiz.\nBir battleda faqat bitta odamga ovoz beriladi.`);
  }

  const inBattleChannel = await isMemberOf(bot, ctx.from.id, battle.channel);
  if (!inBattleChannel) {
    const channelLink = `https://t.me/${battle.channel.replace('@', '')}`;
    return ctx.reply(
      `❌ Ovoz berish uchun avval ${battle.channel} kanaliga obuna bo'ling, so'ng qaytadan urinib ko'ring!`,
      Markup.inlineKeyboard([[inlineUrlBtn('vb_subscribe', `📢 ${battle.channel} ga obuna bo'lish`, channelLink)]])
    );
  }

  const reqOk = await checkRequiredChannels(bot, ctx.from.id);
  if (!reqOk) {
    const buttons = settings.requiredChannels.map(ch => [
      inlineUrlBtn('vb_subscribe', `📢 ${ch}`, `https://t.me/${ch.replace('@', '')}`)
    ]);
    return ctx.reply('❌ Majburiy kanallarga obuna bo\'ling, so\'ng qaytadan urinib ko\'ring:', Markup.inlineKeyboard(buttons));
  }

  if (settings.captchaOnVote) {
    return requireCaptchaThen(ctx, cancelMenu, async () => finalizeVote(bot, ctx, battle, targetUserId));
  }
  return finalizeVote(bot, ctx, battle, targetUserId);
}

async function finalizeVote(bot, ctx, battle, targetUserId) {
  const voterId = String(ctx.from.id);
  const target = findParticipant(battle, targetUserId);
  battle.votes[voterId] = { targetUserId: String(targetUserId), username: target ? target.username : null, votedAt: Date.now() };
  if (!users[voterId]) getUser(ctx); // xavfsizlik uchun — deyarli har doim allaqachon mavjud
  users[voterId].votes = (users[voterId].votes || 0) + 1;
  saveBattles();
  saveUsers();
  bumpActivity(voterId, 1);

  await ctx.reply(`✅ ${target ? displayName(target) : 'Ishtirokchi'}ga ovoz berdingiz! 📦`, mainMenu());
  await updateBattlePost(bot, battle);

  if (battle.target > 0) {
    const count = getVotesForParticipant(battle, targetUserId);
    if (count >= battle.target) {
      await declareWinner(bot, battle, targetUserId);
    }
  }
}

async function handleJoin(bot, ctx, battleId) {
  const user = getUser(ctx);
  if (user.banned) return ctx.reply('🚫 Siz ban qilingansiz.');

  const battle = battles[battleId];
  if (!battle) return ctx.reply('❌ Battle topilmadi.');
  if (!battle.active) return ctx.reply('❌ Bu battle tugagan.');

  const uid = String(ctx.from.id);

  const inBattleChannel = await isMemberOf(bot, ctx.from.id, battle.channel);
  if (!inBattleChannel) {
    const channelLink = `https://t.me/${battle.channel.replace('@', '')}`;
    return ctx.reply(
      `❌ Battlega qo'shilish uchun avval ${battle.channel} kanaliga obuna bo'ling, so'ng qaytadan urinib ko'ring!`,
      Markup.inlineKeyboard([[inlineUrlBtn('vb_subscribe', `📢 ${battle.channel} ga obuna bo'lish`, channelLink)]])
    );
  }

  const reqOk = await checkRequiredChannels(bot, ctx.from.id);
  if (!reqOk) {
    const buttons = settings.requiredChannels.map(ch => [
      inlineUrlBtn('vb_subscribe', `📢 ${ch}`, `https://t.me/${ch.replace('@', '')}`)
    ]);
    return ctx.reply('❌ Majburiy kanallarga obuna bo\'ling, so\'ng qaytadan urinib ko\'ring:', Markup.inlineKeyboard(buttons));
  }

  if (findParticipant(battle, uid)) {
    const voteLink = `https://t.me/${BOT_USERNAME}?start=vote-${battle.battleId}-${uid}`;
    return ctx.reply(
      `✅ Siz allaqachon bu battledasiz!\n\n🔗 Sizning ovoz havolangiz:\n${voteLink}`,
      { disable_web_page_preview: true }
    );
  }

  if (settings.captchaOnJoin) {
    return requireCaptchaThen(ctx, cancelMenu, async () => finalizeJoin(bot, ctx, battle));
  }
  return finalizeJoin(bot, ctx, battle);
}

async function finalizeJoin(bot, ctx, battle) {
  const uid = String(ctx.from.id);
  battle.participants.push({ userId: uid, username: ctx.from.username || null });
  if (!users[uid]) getUser(ctx);
  users[uid].joinedBattles = (users[uid].joinedBattles || 0) + 1;
  saveBattles();
  saveUsers();
  bumpActivity(uid, 2);

  const voteLink = `https://t.me/${BOT_USERNAME}?start=vote-${battle.battleId}-${uid}`;
  await ctx.reply(
    `✅ <b>Battlega muvaffaqiyatli qo'shildingiz!</b>\n\n` +
    `🔗 <b>Sizning ovoz havolangiz:</b>\n${voteLink}\n\n` +
    `📨 Havolani do'stlaringizga yuboring va ovoz yig'ing! 📦`,
    { parse_mode: 'HTML', disable_web_page_preview: true }
  );
  await updateBattlePost(bot, battle);
}

// Oddiy matnli bar-chart: eng ko'p ovozga nisbatan ustunlar chiziladi.
// Tashqi kutubxona yoki rasm generatsiyasiz, faqat Unicode bloklar bilan.
function buildAsciiBarChart(sorted, maxBars = 10) {
  if (sorted.length === 0) return '';
  const top = sorted.slice(0, maxBars);
  const maxCount = Math.max(...top.map(p => p.count), 1);
  const BAR_WIDTH = 12;
  let out = '';
  top.forEach(p => {
    const filled = Math.max(1, Math.round((p.count / maxCount) * BAR_WIDTH));
    const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
    out += `${bar} ${p.count}  ${displayName(p)}\n`;
  });
  return out;
}

async function handleResults(ctx, battleId) {
  const battle = battles[battleId];
  if (!battle) return ctx.reply('❌ Battle topilmadi.');

  const sorted = battle.participants
    .map(p => ({ ...p, count: getVotesForParticipant(battle, p.userId) }))
    .sort((a, b) => b.count - a.count);

  let text = `📊 <b>Battle Natijalari</b>\n\n`;
  text += `🎁 Sovrin: ${prizeText(battle)}\n`;
  if (battle.target) text += `🎯 Maqsad: ${battle.target} ovoz\n`;
  if (battle.endAt)  text += `⏰ Tugash vaqti: ${formatGmt5(battle.endAt)}\n`;
  text += `📌 Holat: ${battle.active ? '🟢 Aktiv' : '🔴 Tugagan'}\n\n`;
  text += `📈 <b>Reyting:</b>\n\n`;

  if (sorted.length === 0) {
    text += 'Hali ishtirokchilar yo\'q.';
  } else {
    sorted.forEach((p, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      text += `${medal} ${displayName(p)} — ${p.count} 📦\n`;
    });
    text += `\n<code>${buildAsciiBarChart(sorted)}</code>`;
  }
  await ctx.reply(text, { parse_mode: 'HTML' });
}

// ============================================================
//     "MENING OVOZ BATTLELARIM" MENYUSI (qatnashchi/ovoz ko'rinishi bilan)
// ============================================================
function battleListButtons(myBattles) {
  const active   = myBattles.filter(b =>  b.active);
  const finished = myBattles.filter(b => !b.active);
  const buttons  = [];

  active.forEach(b => {
    const v = Object.keys(b.votes).length;
    const label = b.target ? `${v}/${b.target}` : `${v} ovoz`;
    buttons.push([inlineBtn('vb_manage_open', `🟢 ${prizeText(b).substring(0, 20)} (${label})`, `bm_${b.battleId}`)]);
  });
  finished.slice(0, 8).forEach(b => {
    buttons.push([inlineBtn('vb_manage_open', `🔴 ${prizeText(b).substring(0, 20)}`, `bi_${b.battleId}`)]);
  });

  return { active, finished, buttons };
}

async function showMyBattlesMenu(bot, ctx) {
  const myBattles = await getBattlesVisibleToUser(bot, ctx.from.id);
  if (myBattles.length === 0) {
    return ctx.reply(
      '📋 Sizda hali ovoz battle yo\'q.\n\nShaxsiy battle yaratish uchun "🏆 Battle yaratish"ni bosing, yoki admin bo\'lgan kanalingizda <code>#boshla</code> yozing.',
      { parse_mode: 'HTML', ...mainMenu() }
    );
  }

  const { active, finished, buttons } = battleListButtons(myBattles);
  await ctx.reply(
    `📋 <b>Mening ovoz battlelarim</b>\n\n🟢 Aktiv: ${active.length}\n🔴 Tugagan: ${finished.length}`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) }
  );
}

async function canManageBattle(bot, ctx, battle) {
  if (!battle) return false;
  if (battle.owner === ctx.from.id) return true;
  if (battle.owner === 0) return await isChannelAdminOf(bot, ctx.from.id, battle.chatId);
  return false;
}

function buildBattleManagePanel(battle) {
  const v = Object.keys(battle.votes).length;
  let text = `📋 <b>Battle Boshqaruvi</b>\n\n🎁 ${prizeText(battle)}\n`;
  if (battle.target) text += `🎯 Maqsad: ${battle.target}\n`;
  if (battle.endAt)  text += `⏰ Tugash: ${formatGmt5(battle.endAt)}\n`;
  text += `👥 Ishtirokchilar: ${battle.participants.length}\n📦 Ovozlar: ${v}\n📢 ${battle.channel}\n📌 ${battle.active ? '🟢 Aktiv' : '🔴 Tugagan'}`;

  const rows = [
    [inlineBtn('vb_participants', '👥 Ishtirokchilar', `bp_${battle.battleId}`)],
    [inlineBtn('vb_voters', '🗳 Ovoz berganlar', `bv_${battle.battleId}`)],
    [inlineBtn('vb_results_panel', '📊 Natijalar', `bi_${battle.battleId}`)]
  ];
  if (battle.active) {
    rows.push([inlineBtn('vb_change_target', '🎯 Maqsadni o\'zgartirish', `bc_${battle.battleId}`)]);
    rows.push([inlineBtn('vb_stop', '🔴 Battle stop', `bs_${battle.battleId}`)]);
  }
  rows.push([inlineBtn('vb_refresh', '🔄 Yangilash', `bm_${battle.battleId}`)]);
  rows.push([inlineBtn('vb_back', '◀️ Orqaga', 'back_battles')]);

  return { text, keyboard: Markup.inlineKeyboard(rows) };
}

// ============================================================
//                   BATTLE SHABLONLARI
//   Foydalanuvchi tez-tez bir xil sozlama (matn/maqsad/kanal) bilan
//   battle yaratsa, buni shablon sifatida saqlab, keyingi safar
//   qaytadan yozmasdan tanlab olishi mumkin.
// ============================================================
function getUserTemplates(ownerId, type) {
  return Object.values(templates).filter(t => t.owner === ownerId && t.type === type);
}

function buildTemplatePickKeyboard(list) {
  const rows = list.map(t => [inlineBtn('vb_template_pick', `🗂 ${t.name}`, `vbtpl_${t.templateId}`)]);
  rows.push([inlineBtn('vb_new_manual', '✏️ Qo\'lda yaratish', 'vbtpl_manual')]);
  return Markup.inlineKeyboard(rows);
}

function registerVoteBattleHandlers(bot) {
  bot.hears('🏆 Battle yaratish', async (ctx) => {
    const user = getUser(ctx);
    if (user.banned) return ctx.reply('🚫 Siz ban qilingansiz.');

    const myTemplates = getUserTemplates(ctx.from.id, 'battle');
    if (myTemplates.length > 0) {
      return ctx.reply(
        '🏆 <b>Battle yaratish</b>\n\nSaqlangan shablonlaringiz bor — shulardan birini ishlatasizmi, yoki qo\'lda yaratasizmi?',
        { parse_mode: 'HTML', reply_markup: buildTemplatePickKeyboard(myTemplates).reply_markup }
      );
    }

    setState(ctx.from.id, { step: 'battle_text' });
    await ctx.reply(
      `🏆 <b>Battle yaratish</b>\n\n📝 Battle matnini kiriting (sovrin nomi):\n\nMisol:\n• 🥇 Top 1 ga gift\n• 🎁 100 Stars\n• 🏆 Premium 1 oy\n\nYoki sovrinni sir saqlash uchun "-" yuboring.`,
      { parse_mode: 'HTML', ...cancelMenu() }
    );
  });

  bot.action('vbtpl_manual', async (ctx) => {
    await ctx.answerCbQuery();
    setState(ctx.from.id, { step: 'battle_text' });
    try { await ctx.editMessageText('✏️ Qo\'lda yaratish tanlandi.'); } catch (e) {}
    await ctx.reply(
      `📝 Battle matnini kiriting (sovrin nomi):\n\nYoki sovrinni sir saqlash uchun "-" yuboring.`,
      cancelMenu()
    );
  });

  bot.action(/^vbtpl_(.+)$/, async (ctx) => {
    const tpl = templates[ctx.match[1]];
    if (!tpl || tpl.owner !== ctx.from.id) return ctx.answerCbQuery('❌ Shablon topilmadi.', { show_alert: true });
    await ctx.answerCbQuery();
    setState(ctx.from.id, {
      step: 'battle_channel',
      battleText: tpl.text, battleTarget: tpl.target, fromTemplate: true
    });
    try { await ctx.editMessageText(`✅ "${tpl.name}" shabloni tanlandi.`); } catch (e) {}
    await ctx.reply(
      `📢 Kanal username kiriting:\nMisol: @mystarchannel`,
      cancelMenu()
    );
  });

  bot.action('vb_save_tpl_yes', async (ctx) => {
    const state = getState(ctx.from.id);
    if (!state || state.step !== 'battle_save_template_choice') return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    state.step = 'battle_template_name';
    setState(ctx.from.id, state);
    try { await ctx.editMessageText('💾 Shablon sifatida saqlanadi.'); } catch (e) {}
    await ctx.reply('📝 Shablon uchun qisqa nom kiriting (masalan: "Oyiga bir marta"):', cancelMenu());
  });

  bot.action('vb_save_tpl_no', async (ctx) => {
    const state = getState(ctx.from.id);
    if (!state || state.step !== 'battle_save_template_choice') return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    clearState(ctx.from.id);
    try { await ctx.editMessageText('➡️ O\'tkazib yuborildi.'); } catch (e) {}
  });

  bot.hears('📋 Mening ovoz battlelarim', async (ctx) => {
    const user = getUser(ctx);
    if (user.banned) return ctx.reply('🚫 Siz ban qilingansiz.');
    return showMyBattlesMenu(bot, ctx);
  });

  bot.action(/^bm_(.+)$/, async (ctx) => {
    const battle = battles[ctx.match[1]];
    if (!(await canManageBattle(bot, ctx, battle))) return ctx.answerCbQuery('🚫 Sizda ruxsat yo\'q.', { show_alert: true });
    await ctx.answerCbQuery();
    const { text, keyboard } = buildBattleManagePanel(battle);
    try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard.reply_markup }); }
    catch (e) { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard.reply_markup }); }
  });

  bot.action(/^bp_(.+)$/, async (ctx) => {
    const battle = battles[ctx.match[1]];
    if (!(await canManageBattle(bot, ctx, battle))) return ctx.answerCbQuery('🚫 Sizda ruxsat yo\'q.', { show_alert: true });
    await ctx.answerCbQuery();
    let text = `👥 <b>Ishtirokchilar</b> (${battle.participants.length})\n\n`;
    text += battle.participants.length
      ? battle.participants.map((p, i) => `${i + 1}. ${displayName(p)}`).join('\n')
      : 'Hali ishtirokchilar yo\'q.';
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([[inlineBtn('vb_back', '◀️ Orqaga', `bm_${battle.battleId}`)]]).reply_markup });
  });

  bot.action(/^bv_(.+)$/, async (ctx) => {
    const battle = battles[ctx.match[1]];
    if (!(await canManageBattle(bot, ctx, battle))) return ctx.answerCbQuery('🚫 Sizda ruxsat yo\'q.', { show_alert: true });
    await ctx.answerCbQuery();
    const entries = Object.entries(battle.votes);
    let text = `🗳 <b>Ovoz berganlar</b> (${entries.length})\n\n`;
    if (entries.length === 0) {
      text += 'Hali hech kim ovoz bermagan.';
    } else {
      text += entries.map(([voterId, v]) => {
        const voter = users[voterId];
        const voterName = voter && voter.username ? '@' + voter.username : `ID:${voterId}`;
        const targetP = findParticipant(battle, v.targetUserId);
        return `${voterName} → ${targetP ? displayName(targetP) : 'ID:' + v.targetUserId}`;
      }).join('\n');
    }
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([[inlineBtn('vb_back', '◀️ Orqaga', `bm_${battle.battleId}`)]]).reply_markup });
  });

  bot.action(/^bi_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const battle = battles[ctx.match[1]];
    if (!battle) return;

    const sorted = battle.participants
      .map(p => ({ ...p, count: getVotesForParticipant(battle, p.userId) }))
      .sort((a, b) => b.count - a.count);

    let text = `📊 <b>Natijalar</b>\n\n🎁 ${prizeText(battle)}\n`;
    if (battle.target) text += `🎯 Maqsad: ${battle.target}\n`;
    text += `\n📈 <b>Reyting:</b>\n\n`;
    if (sorted.length === 0) { text += 'Hali ishtirokchilar yo\'q.'; }
    else {
      sorted.forEach((p, i) => { const m = i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}.`; text += `${m} ${displayName(p)} — ${p.count} 📦\n`; });
      text += `\n<code>${buildAsciiBarChart(sorted)}</code>`;
    }

    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([[inlineBtn('vb_back', '◀️ Orqaga', `bm_${battle.battleId}`)]]).reply_markup });
  });

  bot.action(/^bc_(.+)$/, async (ctx) => {
    const battle = battles[ctx.match[1]];
    if (!(await canManageBattle(bot, ctx, battle))) return ctx.answerCbQuery('🚫 Sizda ruxsat yo\'q.', { show_alert: true });
    await ctx.answerCbQuery();
    setState(ctx.from.id, { step: 'change_target', battleId: battle.battleId });
    await ctx.reply(`🎯 Yangi maqsad sonini kiriting (hozir: ${battle.target || 'belgilanmagan'}):`, cancelMenu());
  });

  bot.action(/^bs_(.+)$/, async (ctx) => {
    const battle = battles[ctx.match[1]];
    if (!(await canManageBattle(bot, ctx, battle))) return ctx.answerCbQuery('🚫 Sizda ruxsat yo\'q.', { show_alert: true });
    battle.active = false;
    battle.finishedAt = Date.now();
    saveBattles();
    await ctx.answerCbQuery('⛔ Battle to\'xtatildi.');
    try { await bot.telegram.sendMessage(battle.chatId, `⛔ <b>Battle to'xtatildi</b>\n\n🎁 Sovrin: ${prizeText(battle)}`, { parse_mode: 'HTML' }); } catch (e) {}
    try { await ctx.editMessageText('⛔ Battle to\'xtatildi.', { reply_markup: Markup.inlineKeyboard([[inlineBtn('vb_back', '◀️ Orqaga', 'back_battles')]]).reply_markup }); } catch (e) {}
  });

  bot.action('back_battles', async (ctx) => {
    await ctx.answerCbQuery();
    const myBattles = await getBattlesVisibleToUser(bot, ctx.from.id);
    const { active, finished, buttons } = battleListButtons(myBattles);
    try {
      await ctx.editMessageText(
        `📋 <b>Mening ovoz battlelarim</b>\n\n🟢 Aktiv: ${active.length}\n🔴 Tugagan: ${finished.length}`,
        { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard(buttons).reply_markup }
      );
    } catch (e) {}
  });

  // ── Kanal admini uchun avto-yaratilgan #boshla battlelarni to'xtatish ──
  bot.command('stopboshla', async (ctx) => {
    const active = Object.values(battles).filter(b => b.active && b.owner === 0);
    if (active.length === 0) return ctx.reply('🏆 Aktiv avto-#boshla battle topilmadi.');
    const buttons = active.slice(0, 10).map(b => [
      inlineBtn('vb_stopboshla_pick', `🏆 ${b.channel} (${b.participants.length} ishtirokchi)`, `boshlastop_${b.battleId}`)
    ]);
    await ctx.reply('🏆 To\'xtatish uchun battlani tanlang:', Markup.inlineKeyboard(buttons));
  });

  bot.action(/^boshlastop_(.+)$/, async (ctx) => {
    const battle = battles[ctx.match[1]];
    if (!battle) return ctx.answerCbQuery('❌ Topilmadi.', { show_alert: true });
    const ok = await isChannelAdminOf(bot, ctx.from.id, battle.chatId);
    if (!ok) return ctx.answerCbQuery('🚫 Faqat kanal admini to\'xtata oladi.', { show_alert: true });
    battle.active = false;
    battle.finishedAt = Date.now();
    saveBattles();
    await ctx.answerCbQuery('⛔ To\'xtatildi.');
    try { await bot.telegram.sendMessage(battle.chatId, `⛔ <b>Battle to'xtatildi</b>\n\n🎁 Sovrin: ${prizeText(battle)}`, { parse_mode: 'HTML' }); } catch (e) {}
    try { await ctx.editMessageText('✅ Battle to\'xtatildi.'); } catch (e) {}
  });
}

// Shablon nomi kiritilganda chaqiriladi (markaziy text handlerdan)
async function handleTemplateNameTextState(ctx, state) {
  const name = ctx.message.text.trim().slice(0, 40);
  if (!name) { await ctx.reply('❌ Bo\'sh nom bo\'lishi mumkin emas, qayta kiriting.'); return true; }

  const templateId = generateId();
  templates[templateId] = {
    templateId, owner: ctx.from.id, type: 'battle', name,
    text: state.battleText, target: state.battleTarget || 0,
    createdAt: Date.now()
  };
  saveTemplates();
  clearState(ctx.from.id);
  await ctx.reply(`✅ "${name}" shablon sifatida saqlandi. Keyingi safar "🏆 Battle yaratish"da tanlab olishingiz mumkin.`, mainMenu());
  return true;
}

module.exports = {
  buildBattlePost, buildBattleKeyboard, updateBattlePost,
  declareWinner, stopBattleNoWinner, autoCreateBoshlaBattle,
  handleVote, finalizeVote, handleJoin, finalizeJoin, handleResults,
  getBattlesByOwner, getBattlesVisibleToUser, getVotesForParticipant,
  findParticipant, displayName,
  registerVoteBattleHandlers, handleTemplateNameTextState
};
