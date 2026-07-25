const { Telegraf, Markup } = require('telegraf');
const { BOT_TOKEN, BOT_USERNAME, ADMIN_IDS, isAdmin } = require('./config');
const { battles, contests, likebatls, users, settings, saveBattles, saveContests, saveUsers, saveLikebatls } = require('./db');
const {
  getUser, isChannelAdminOf, pendingCaptcha, generateId, parseGmt5DateTime, formatGmt5, checkRequiredChannels
} = require('./helpers');
const { setState, getState, clearState } = require('./state');
const { mainMenu, cancelMenu } = require('./keyboards');
const { inlineUrlBtn, inlineBtn } = require('./buttons');

const VoteBattle = require('./modules/voteBattle');
const RandomContest = require('./modules/randomContest');
const LikeBattle = require('./modules/likeBattle');
const Admin = require('./modules/admin');
const { startCronJobs } = require('./cron');
const { antiSpamMiddleware } = require('./antispam');

const bot = new Telegraf(BOT_TOKEN);

// Anti-spam — barcha boshqa handlerlardan OLDIN ishlashi kerak
bot.use(antiSpamMiddleware());

// ============================================================
//   MAJBURIY OBUNA (GLOBAL GATE)
//   Admin panelda belgilangan kanallarga a'zo bo'lmagan foydalanuvchi
//   botga istalgan xabar yozganda (yoki istalgan tugma bossa) avval
//   shu ro'yxat bilan to'xtatiladi. /start har doim o'tadi (chunki
//   foydalanuvchi botni umuman boshlay olishi kerak), captcha javobi
//   ham bloklanmaydi (aks holda captcha oqimi hech qachon tugamaydi).
// ============================================================
function buildSubscribeKeyboard() {
  const rows = settings.requiredChannels.map(ch => [
    inlineUrlBtn('gate_subscribe', `📢 ${ch}`, `https://t.me/${ch.replace('@', '')}`)
  ]);
  rows.push([inlineBtn('gate_check', '✅ Tekshirish', 'gate_check')]);
  return Markup.inlineKeyboard(rows);
}

async function sendSubscribeGate(ctx) {
  await ctx.reply(
    '🔒 <b>Davom etish uchun quyidagi kanallarga obuna bo\'ling:</b>\n\n' +
    settings.requiredChannels.map(c => `📢 ${c}`).join('\n') +
    '\n\nObuna bo\'lgach, "✅ Tekshirish" tugmasini bosing.',
    { parse_mode: 'HTML', reply_markup: buildSubscribeKeyboard().reply_markup }
  );
}

bot.use(async (ctx, next) => {
  if (!settings.requiredChannels || settings.requiredChannels.length === 0) return next();
  if (!ctx.from) return next();
  if (isAdmin(ctx.from.id)) return next();

  // Gate faqat shaxsiy chatda ishlaydi — guruh/kanal ichidagi xabarlar
  // yoki botning o'ziga tegishli bo'lmagan update'lar bloklanmasligi kerak.
  if (ctx.chat && ctx.chat.type !== 'private') return next();

  // /start har doim o'tishi kerak (bo'lmasa foydalanuvchi botni boshlay olmaydi).
  const isStartCommand = ctx.message && ctx.message.text && /^\/start(\s|$)/.test(ctx.message.text);
  if (isStartCommand) return next();

  // "✅ Tekshirish" callback'i o'zi shu yerda ishlaydi — quyida alohida.
  const cbData = ctx.callbackQuery && ctx.callbackQuery.data;
  if (cbData === 'gate_check') return next();

  const ok = await checkRequiredChannels(bot, ctx.from.id);
  if (ok) return next();

  if (ctx.callbackQuery) {
    try { await ctx.answerCbQuery('🔒 Avval majburiy kanallarga obuna bo\'ling.', { show_alert: true }); } catch (e) {}
  }
  return sendSubscribeGate(ctx);
});

bot.action('gate_check', async (ctx) => {
  const ok = await checkRequiredChannels(bot, ctx.from.id);
  if (ok) {
    await ctx.answerCbQuery('✅ Obuna tasdiqlandi!');
    try { await ctx.deleteMessage(); } catch (e) {}
    return ctx.reply('✅ Obuna tasdiqlandi! Botdan foydalanishingiz mumkin.', mainMenu());
  }
  await ctx.answerCbQuery('❌ Hali barcha kanallarga obuna bo\'lmadingiz.', { show_alert: true });
});

// ============================================================
//                      /start (payload routing)
// ============================================================
bot.start(async (ctx) => {
  const user = getUser(ctx);
  if (user.banned) return ctx.reply('🚫 Siz ban qilingansiz.');

  const payload = ctx.startPayload || '';

  if (payload.startsWith('vote-')) {
    const rest = payload.slice(5);
    const dash = rest.indexOf('-');
    if (dash !== -1) return VoteBattle.handleVote(bot, ctx, rest.slice(0, dash), rest.slice(dash + 1));
  }
  if (payload.startsWith('join-'))    return VoteBattle.handleJoin(bot, ctx, payload.slice(5));
  if (payload.startsWith('results-')) return VoteBattle.handleResults(ctx, payload.slice(8));
  if (payload.startsWith('rjoin-'))   return RandomContest.handleRandomJoin(bot, ctx, payload.slice(6));
  if (payload.startsWith('lbjoin-'))  return LikeBattle.handleLikebatlJoin(bot, ctx, payload.slice(7));
  if (payload.startsWith('lbsetup-')) return LikeBattle.handleLikebatlSetupEntry(bot, ctx, payload.slice(8));

  await ctx.reply(
    `👋 Salom, <b>${ctx.from.first_name}</b>!\n\n` +
    `🤖 <b>Bot ishga tushdi!</b>\n\n` +
    `📌 <b>Kanalda:</b>\n` +
    `   • #boshla — ovoz battle (+ ixtiyoriy #soni 50, #vaqt 26.06.28 20:00)\n` +
    `   • #random — random konkurs (+ #soni, #win, #vaqt)\n` +
    `   • #batl — like battle\n\n` +
    `🏆 Shaxsiy ovoz-battle, konkurs yoki like battle yaratish uchun pastdagi menyudan foydalaning.`,
    { parse_mode: 'HTML', ...mainMenu() }
  );
});

// ============================================================
//          HASHTAG AUTO-DETECTION IN CHANNEL POSTS
// ============================================================
bot.on('channel_post', async (ctx) => {
  const msg = ctx.channelPost;
  if (!msg || !msg.text) return;
  const text = msg.text.trim();
  const chatId = msg.chat.id;
  const channelUsername = msg.chat.username ? `@${msg.chat.username}` : String(chatId);

  if (/^#batl\b/i.test(text)) return LikeBattle.autoCreateLikebatl(bot, chatId, channelUsername);
  if (/^#random\b/i.test(text)) return RandomContest.autoCreateRandomContest(bot, chatId, channelUsername, text);
  if (/^#boshla\b/i.test(text)) return VoteBattle.autoCreateBoshlaBattle(bot, chatId, channelUsername, text);
});

// ============================================================
//                  MAIN MENU: STATISTIKA / YORDAM
// ============================================================
bot.hears('📊 Statistika', async (ctx) => {
  const user = getUser(ctx);
  await ctx.reply(
    `📊 <b>Sizning statistikangiz</b>\n\n` +
    `🆔 ID: <code>${user.id}</code>\n` +
    `👤 Username: ${user.username ? '@' + user.username : 'Yo\'q'}\n\n` +
    `🏆 Yaratgan battlelar: ${user.createdBattles || 0}\n` +
    `👥 Qatnashgan battlelar: ${user.joinedBattles || 0}\n` +
    `📦 Yig'ilgan ovozlar: ${user.votes || 0}\n` +
    `🥇 G'alabalar: ${user.wins || 0}\n` +
    `😔 Mag'lubiyatlar: ${user.loses || 0}\n` +
    `🎲 #random qatnashganlar: ${user.randomJoined || 0}\n` +
    `⚡ Faollik balli: ${user.activityScore || 0}`,
    { parse_mode: 'HTML' }
  );
});

bot.hears('ℹ️ Yordam', async (ctx) => {
  await ctx.reply(
    `ℹ️ <b>Yordam</b>\n\n` +
    `🏆 <b>Shaxsiy ovoz-battle:</b> "🏆 Battle yaratish"ni bosing va kanalingizga joylang.\n` +
    `🎲 <b>Random konkurs:</b> "➕ Konkurs yaratish" orqali botda to'liq sozlab yaratasiz.\n` +
    `🥊 <b>Like battle:</b> "➕ Like battle yaratish" orqali botda to'liq sozlab yaratasiz.\n\n` +
    `📌 <b>Kanal ichida avtomatik o'yinlar</b> (botni kanalga admin qiling):\n` +
    `• <code>#boshla</code> matn [+ <code>#soni 50</code>] [+ <code>#vaqt 26.06.28 20:00</code>] — ovoz-battle avto boshlanadi\n` +
    `• <code>#random</code> matn [+ <code>#soni 10</code>] [+ <code>#win 2</code>] [+ <code>#vaqt 26.06.28 20:00</code>] — random konkurs\n` +
    `• <code>#batl</code> — like battle: avval admin botda ball sozlamalarini belgilaydi, keyin kanalda qatnashish boshlanadi\n\n` +
    `📋 <b>Mening ovoz battlelarim</b> / 🎲 <b>Mening konkurslarim</b> / 🥊 <b>Mening like battlelarim</b> — admin bo'lgan kanalingizda boshlangan o'yinlar shu yerda ko'rinadi, boshqarish mumkin.\n\n` +
    `❤️ Reaksiya va 💬 comment tugmalari kanal postida turadi: reaksiya bossangiz darrov hisoblanadi (avval kanalga obuna bo'lishingiz kerak), comment bossangiz botga o'tib matn yozasiz — u kanalga ishtirokchi nomidan izoh sifatida yuboriladi.\n\n` +
    `⏰ Vaqtlar GMT+5 (Toshkent) bo'yicha, format: <code>KK.OO.YY SS:DD</code> (masalan <code>26.06.28 20:00</code>).`,
    { parse_mode: 'HTML' }
  );
});

bot.hears('❌ Bekor qilish', async (ctx) => {
  clearState(ctx.from.id);
  delete pendingCaptcha[String(ctx.from.id)];
  await ctx.reply('❌ Bekor qilindi.', mainMenu());
});

// ============================================================
//          MODUL HANDLERLARINI RO'YXATDAN O'TKAZISH
// ============================================================
VoteBattle.registerVoteBattleHandlers(bot);
RandomContest.registerRandomContestHandlers(bot);
LikeBattle.registerLikeBattleHandlers(bot);
Admin.registerAdminHandlers(bot);

// ============================================================
//      MARKAZIY TEXT / STATE MACHINE HANDLER
// ============================================================
bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;

  const user = getUser(ctx);
  if (user.banned) return;

  // ── CAPTCHA JAVOBI ──
  const cap = pendingCaptcha[String(ctx.from.id)];
  if (cap) {
    const answer = parseInt(text, 10);
    if (isNaN(answer)) return ctx.reply('❌ Faqat son kiriting.');
    if (answer !== cap.answer) {
      delete pendingCaptcha[String(ctx.from.id)];
      return ctx.reply('❌ Noto\'g\'ri javob. Qaytadan urinib ko\'ring.', mainMenu());
    }
    delete pendingCaptcha[String(ctx.from.id)];
    await ctx.reply('✅ Tasdiqlandi!');
    return cap.runAction();
  }

  const state = getState(ctx.from.id);
  if (!state) return;

  // ── Admin holatlari (markazlashtirilgan) ──
  if (await Admin.handleAdminTextState(ctx, state)) return;

  // ── LIKE BATTLE: comment yozish (kanal postidagi 💬 tugmasidan) ──
  if (state.step === 'lb_write_comment') {
    if (await LikeBattle.handleCommentTextState(bot, ctx, state)) return;
  }

  // ── LIKE BATTLE: botda yaratish wizard holatlari ──
  if (state.step.startsWith('lbc_')) {
    if (await LikeBattle.handleLikebatlCreationTextState(bot, ctx, state)) return;
  }

  // ── RANDOM KONKURS: botda yaratish wizard holatlari ──
  if (state.step.startsWith('rc_')) {
    if (await RandomContest.handleRandomCreationTextState(bot, ctx, state)) return;
  }

  // ── BATTLE CREATION (shaxsiy, menyu orqali) ──
  if (state.step === 'battle_text') {
    state.battleText = text === '-' ? '' : text;
    state.step = 'battle_target';
    setState(ctx.from.id, state);
    return ctx.reply(
      '✅ Matn saqlandi!\n\n🎯 G\'olib uchun kerakli ovoz sonini kiriting (faqat son):\nMisol: 10, 50, 100\n\nYoki vaqt bilan tugatish uchun "0" yozing (keyin tugash vaqtini so\'raymiz).',
      cancelMenu()
    );
  }

  if (state.step === 'battle_target') {
    const target = parseInt(text, 10);
    if (isNaN(target) || target < 0) return ctx.reply('❌ To\'g\'ri son kiriting (0 — faqat vaqt bilan tugatish uchun).');
    state.battleTarget = target;
    state.step = 'battle_channel';
    setState(ctx.from.id, state);
    return ctx.reply(
      `✅ ${target > 0 ? `Maqsad: ${target} ovoz` : 'Maqsad belgilanmadi (vaqt bilan tugaydi)'}\n\n📢 Kanal username kiriting:\nMisol: @mystarchannel`,
      cancelMenu()
    );
  }

  if (state.step === 'battle_channel') {
    let channel = text;
    if (!channel.startsWith('@')) channel = '@' + channel;

    let chatInfo;
    try { chatInfo = await ctx.telegram.getChat(channel); }
    catch (e) { return ctx.reply('❌ Kanal topilmadi.\n\nIltimos, botni kanalga admin qilib qo\'shing va qaytadan urinib ko\'ring.', cancelMenu()); }

    try {
      const me = await ctx.telegram.getChatMember(channel, ctx.botInfo.id);
      if (!['administrator', 'creator'].includes(me.status)) {
        return ctx.reply('❌ Bot kanalda admin emas!\n\nIltimos, botni kanalga admin qilib qo\'shing va qaytadan urinib ko\'ring.', cancelMenu());
      }
    } catch (e) {
      return ctx.reply('❌ Bot kanalda admin emas.\n\nIltimos, botni kanalga admin qilib qo\'shing va qaytadan urinib ko\'ring.', cancelMenu());
    }

    try {
      const requester = await ctx.telegram.getChatMember(channel, ctx.from.id);
      if (!['administrator', 'creator'].includes(requester.status)) {
        return ctx.reply('❌ Siz bu kanalda admin emassiz!\n\nIltimos, kanalda admin bo\'lib, keyin battle yarating.', cancelMenu());
      }
    } catch (e) {
      return ctx.reply('❌ Siz bu kanalda admin emassiz!\n\nIltimos, kanalda admin bo\'lib, keyin battle yarating.', cancelMenu());
    }

    if (state.battleTarget === 0) {
      state.step = 'battle_endtime';
      state.battleChannel = channel;
      state.chatId = chatInfo.id;
      setState(ctx.from.id, state);
      return ctx.reply(
        '⏰ Battle tugash vaqtini kiriting (GMT+5 bo\'yicha):\n\nFormat: <code>KK.OO.YY SS:DD</code>\nMisol: <code>26.06.28 20:00</code>',
        { parse_mode: 'HTML', ...cancelMenu() }
      );
    }

    return createPersonalBattle(ctx, state, channel, chatInfo.id, null);
  }

  if (state.step === 'battle_endtime') {
    const endAt = parseGmt5DateTime(text);
    if (!endAt) return ctx.reply('❌ Format noto\'g\'ri. Misol: 26.06.28 20:00', cancelMenu());
    if (endAt <= Date.now()) return ctx.reply('❌ Bu vaqt allaqachon o\'tib ketgan. Kelajakdagi vaqt kiriting.', cancelMenu());
    return createPersonalBattle(ctx, state, state.battleChannel, state.chatId, endAt);
  }

  // ── BATTLE SHABLONI: nom kiritish ──
  if (state.step === 'battle_template_name') {
    if (await VoteBattle.handleTemplateNameTextState(ctx, state)) return;
  }

  // ── CHANGE TARGET (egasi yoki kanal admini) ──
  if (state.step === 'change_target') {
    const newTarget = parseInt(text, 10);
    if (isNaN(newTarget) || newTarget < 0) return ctx.reply('❌ To\'g\'ri son kiriting.');
    const battle = battles[state.battleId];
    if (!battle) { clearState(ctx.from.id); return ctx.reply('❌ Battle topilmadi.', mainMenu()); }
    const allowed = battle.owner === ctx.from.id || (battle.owner === 0 && await isChannelAdminOf(bot, ctx.from.id, battle.chatId));
    if (!allowed) { clearState(ctx.from.id); return ctx.reply('🚫 Sizda ruxsat yo\'q.', mainMenu()); }
    const old = battle.target;
    battle.target = newTarget;
    saveBattles();
    clearState(ctx.from.id);
    await ctx.reply(`✅ Maqsad ${old || 'yo\'q'} → ${newTarget || 'yo\'q'} ga o'zgartirildi!`, mainMenu());
    await VoteBattle.updateBattlePost(bot, battle);
    return;
  }

  // ── LIKE BATTLE: sozlashdan oldingi ball kiritish (#batl, kanaldan kelgan setup) ──
  if (state.step === 'lbsetup_reaction' || state.step === 'lbsetup_stars' || state.step === 'lbsetup_comment') {
    const v = parseInt(text, 10);
    if (isNaN(v) || v < 0) return ctx.reply('❌ To\'g\'ri son kiriting.');
    const lb = likebatls[state.battleId];
    if (!lb || lb.setupDone) { clearState(ctx.from.id); return ctx.reply('❌ Sozlama topilmadi yoki yakunlangan.', mainMenu()); }

    const field = state.step === 'lbsetup_reaction' ? 'pointsPerReaction' : state.step === 'lbsetup_stars' ? 'pointsPerStars' : 'pointsPerComment';
    const label = state.step === 'lbsetup_reaction' ? 'Reaksiya' : state.step === 'lbsetup_stars' ? 'Stars' : 'Comment';
    lb[field] = v;
    saveLikebatls();
    clearState(ctx.from.id);
    await ctx.reply(`✅ ${label} uchun ball: ${v}`, mainMenu());
    const { buildLikebatlSetupMenu, buildLikebatlSetupKeyboard } = LikeBattle;
    await ctx.reply(buildLikebatlSetupMenu(lb), { parse_mode: 'HTML', reply_markup: buildLikebatlSetupKeyboard(lb).reply_markup });
    return;
  }

  // ── LIKE BATTLE: jonli battle ball sozlamalari (/lb orqali) ──
  if (state.step === 'lb_set_reaction' || state.step === 'lb_set_stars' || state.step === 'lb_set_comment') {
    const v = parseInt(text, 10);
    if (isNaN(v) || v < 0) return ctx.reply('❌ To\'g\'ri son kiriting.');
    const lb = likebatls[state.battleId];
    if (!lb) { clearState(ctx.from.id); return ctx.reply('❌ Battle topilmadi.', mainMenu()); }

    const { recalcScore } = LikeBattle;
    const field = state.step === 'lb_set_reaction' ? 'pointsPerReaction' : state.step === 'lb_set_stars' ? 'pointsPerStars' : 'pointsPerComment';
    const label = state.step === 'lb_set_reaction' ? 'Reaksiya' : state.step === 'lb_set_stars' ? 'Stars' : 'Comment';
    lb[field] = v;
    lb.participants.forEach(p => recalcScore(p, lb));
    saveLikebatls();
    clearState(ctx.from.id);
    await ctx.reply(`✅ ${label} uchun ball: ${v}`, mainMenu());
    return;
  }

  // ── ADMIN: BROADCAST (matnli) ──
  if (state.step === 'admin_broadcast') {
    return Admin.sendBroadcast(bot, ctx, ctx.message.message_id);
  }
});

async function createPersonalBattle(ctx, state, channel, chatId, endAt) {
  const battleId = generateId();
  const battle = {
    battleId, owner: ctx.from.id, channel, chatId,
    text: state.battleText, target: state.battleTarget || 0, endAt: endAt || null,
    active: true, participants: [], votes: {},
    messageId: null, createdAt: Date.now()
  };

  battles[battleId] = battle;
  const uid = String(ctx.from.id);
  users[uid].createdBattles = (users[uid].createdBattles || 0) + 1;
  saveBattles();
  saveUsers();

  const fromTemplate = !!state.fromTemplate;
  clearState(ctx.from.id);

  try {
    const msg = await ctx.telegram.sendMessage(
      channel, VoteBattle.buildBattlePost(battle),
      { parse_mode: 'HTML', reply_markup: VoteBattle.buildBattleKeyboard(battle).reply_markup }
    );
    battles[battleId].messageId = msg.message_id;
    saveBattles();
    await ctx.reply(
      `✅ Battle yaratildi!\n\n🆔 <code>${battleId}</code>\n📢 ${channel}\n${battle.target ? `🎯 ${battle.target} ovoz\n` : ''}${battle.endAt ? `⏰ Tugash: ${formatGmt5(battle.endAt)}\n` : ''}`,
      { parse_mode: 'HTML', ...mainMenu() }
    );

    // Shablondan foydalanilmagan bo'lsa — kelajakda tez yaratish uchun
    // shablon sifatida saqlashni taklif qilamiz.
    if (!fromTemplate) {
      setState(ctx.from.id, { step: 'battle_save_template_choice', battleText: battle.text, battleTarget: battle.target });
      await ctx.reply(
        '💾 Bu sozlamani keyingi safar qayta yozmasdan ishlatish uchun shablon qilib saqlaymizmi?',
        Markup.inlineKeyboard([
          [Markup.button.callback('💾 Shablon sifatida saqlash', 'vb_save_tpl_yes')],
          [Markup.button.callback('➡️ Saqlamasdan o\'tish', 'vb_save_tpl_no')]
        ])
      );
    }
  } catch (e) {
    delete battles[battleId];
    saveBattles();
    await ctx.reply(`❌ Kanalga post yubora olmadi:\n${e.message}`, mainMenu());
  }
}

// ============================================================
//                    ERROR HANDLER
// ============================================================
bot.catch((err, ctx) => {
  console.error(`[ERROR]:`, err.message || err);
  try {
    if (ctx.callbackQuery) ctx.answerCbQuery('❌ Xato yuz berdi.').catch(() => {});
    else ctx.reply('❌ Xato yuz berdi.').catch(() => {});
  } catch (_) {}
});

// ============================================================
//                      LAUNCH
// ============================================================
// MUHIM: Railway (va boshqa hosting'lar) konteyner ishga tushgach
// darhol HTTP portga health-check so'rovi yuboradi. Agar port faqat
// bot.launch() muvaffaqiyatli tugagandan KEYIN ochilsa (Telegram API
// bilan bog'lanish sekinlashsa yoki vaqtincha uzilsa), Railway
// "Application failed to respond" xatosini beradi — garchi bot
// keyinroq to'g'ri ishga tushsa ham. Shu sabab web-server bot
// polling'idan MUSTAQIL, eng birinchi bo'lib ochiladi.
const { createServer } = require('./webserver');
const { app } = createServer();
app.set('botInstance', bot);

bot.launch({
  // message_reaction — like battledagi ⭐ Stars paid-reaction kuzatuvi
  // uchun kerak (bot buni kuzatadi, lekin o'zi paid reaction yubormaydi).
  // pre_checkout_query/successful_payment endi kerak emas — Stars endi
  // invoice orqali emas, kanal reaction orqali yig'iladi.
  allowedUpdates: ['message', 'callback_query', 'channel_post', 'message_reaction']
})
  .then(async () => {
    console.log(`✅ Bot ishga tushdi! @${BOT_USERNAME}`);
    console.log(`🔑 Admin panel: /admin (ADMIN_IDS: ${ADMIN_IDS.join(', ') || 'belgilanmagan'})`);
    startCronJobs(bot);

    for (const adminId of ADMIN_IDS) {
      try { await bot.telegram.sendMessage(adminId, `✅ Bot ishga tushdi (@${BOT_USERNAME})`); } catch (e) {}
    }
  })
  .catch(err => { console.error('❌ Bot ishga tushmadi:', err.message); process.exit(1); });

function shutdown(signal) {
  const { flushAllSyncNow } = require('./db');
  flushAllSyncNow(); // debounce qilingan yozishlarni diskka majburan yozib qo'yish
  bot.stop(signal);
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
