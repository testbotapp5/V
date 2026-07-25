const { Markup } = require('telegraf');
const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const { isAdmin } = require('../config');
const { users, battles, contests, likebatls, settings, saveUsers, saveSettings } = require('../db');
const { findUserByQuery, topActiveUsers } = require('../helpers');
const { setState, getState, clearState } = require('../state');
const { mainMenu, cancelMenu, adminPanel } = require('../keyboards');
const { getRegisteredButtons, inlineBtn } = require('../buttons');

function refreshAdminPanelMarkup() { return adminPanel(); }

function adminOverviewText() {
  const totalUsers    = Object.keys(users).length;
  const bannedUsers   = Object.values(users).filter(u => u.banned).length;
  const totalBattles  = Object.keys(battles).length;
  const activeBattles = Object.values(battles).filter(b => b.active).length;
  const totalContests = Object.keys(contests).length;
  const totalLikebatl = Object.keys(likebatls).length;

  return `⚙️ <b>Admin Panel</b>\n\n` +
    `👥 Foydalanuvchilar: ${totalUsers}\n` +
    `🚫 Banlangan: ${bannedUsers}\n` +
    `🏆 Jami #boshla battlelar: ${totalBattles}\n` +
    `🟢 Aktiv: ${activeBattles}\n` +
    `🎲 #random soni: ${totalContests}\n` +
    `🥊 #batl (like battle) soni: ${totalLikebatl}\n\n` +
    `📢 Majburiy kanallar:\n${settings.requiredChannels.map(c => `• ${c}`).join('\n') || 'Yo\'q'}`;
}

async function sendBroadcast(bot, ctx, messageId) {
  const uids = Object.keys(users);
  let sent = 0, failed = 0;
  await ctx.reply(`📢 Broadcast boshlandi... ${uids.length} ta foydalanuvchi`);
  for (const uid of uids) {
    try { await bot.telegram.copyMessage(uid, ctx.from.id, messageId); sent++; }
    catch (e) { failed++; }
    await new Promise(r => setTimeout(r, 55));
  }
  clearState(ctx.from.id);
  await ctx.reply(`✅ Broadcast tugadi!\n✅ Yuborildi: ${sent}\n❌ Xato: ${failed}`, mainMenu());
}

// ============================================================
//   😀 CUSTOM EMOJI SOZLAMALARI
//   Har bir statik tugma (buttons.js orqali ro'yxatdan o'tgan)
//   uchun admin custom premium emoji tayinlashi mumkin.
//   Eslatma: icon_custom_emoji_id faqat bot egasi Telegram Premium
//   bo'lsa (yoki bot Fragment orqali qo'shimcha username sotib olgan
//   bo'lsa) tugmada ko'rinadi — bu Bot API ning o'ziga xos cheklovi.
// ============================================================
const EMOJI_PAGE_SIZE = 8;

function emojiOverviewText() {
  const all = getRegisteredButtons();
  const configured = all.filter(b => settings.buttonEmojis[b.key]).length;
  return (
    `😀 <b>Custom Emoji sozlamalari</b>\n\n` +
    `Bu yerda tugmalar va xabarlardagi premium emoji'larni sozlaysiz.\n` +
    `Sozlangan: ${configured}/${all.length}\n\n` +
    `✅ — sozlangan, ⬜️ — sozlanmagan.\n` +
    `O'zgartirish uchun bosing:`
  );
}

function buildEmojiListKeyboard(page = 0) {
  const all = getRegisteredButtons();
  const start = page * EMOJI_PAGE_SIZE;
  const pageItems = all.slice(start, start + EMOJI_PAGE_SIZE);

  const rows = pageItems.map((b, i) => {
    const mark = settings.buttonEmojis[b.key] ? '✅' : '⬜️';
    const globalIdx = start + i;
    return [inlineBtn('admin_emoji_item', `${mark} ${b.label}`, `aemoji_${globalIdx}`)];
  });

  const navRow = [];
  if (page > 0) navRow.push(inlineBtn('admin_emoji_prev', '◀️', `aemojipage_${page - 1}`));
  if (start + EMOJI_PAGE_SIZE < all.length) navRow.push(inlineBtn('admin_emoji_next', '▶️', `aemojipage_${page + 1}`));
  if (navRow.length) rows.push(navRow);

  rows.push([inlineBtn('admin_back', '◀️ Admin panelga qaytish', 'admin_back')]);
  return Markup.inlineKeyboard(rows);
}

function buildEmojiItemText(btnDef) {
  const current = settings.buttonEmojis[btnDef.key];
  let text = `😀 <b>${btnDef.label}</b>\n\n`;
  text += current
    ? `Hozirgi custom emoji ID:\n<code>${current}</code>\n\n`
    : `Hozircha sozlanmagan.\n\n`;
  text += `Kerakli premium emoji'ni botga forward qiling yoki to'g'ridan-to'g'ri yuboring ` +
    `(shu emoji ishtirok etgan istalgan xabar bo'lishi mumkin).\n\n` +
    `Yoki, agar ID'ni bilsangiz, uni raqam sifatida yuboring (masalan: <code>5370645742228663667</code>).`;
  return text;
}

function buildEmojiItemKeyboard(btnDef, page, idx) {
  const rows = [];
  if (settings.buttonEmojis[btnDef.key]) {
    rows.push([inlineBtn('admin_emoji_clear', '🗑 Tozalash (standart emojiga qaytarish)', `aemojiclear_${idx}`)]);
  }
  rows.push([inlineBtn('admin_emoji_back', '◀️ Ro\'yxatga qaytish', `aemojipage_${page}`)]);
  return Markup.inlineKeyboard(rows);
}

// Xabar ichidan custom_emoji entity ID'sini yoki qo'lda kiritilgan raqamni topadi
function extractCustomEmojiId(ctx) {
  const msg = ctx.message;
  if (!msg) return null;

  // 1) Foydalanuvchi to'g'ridan-to'g'ri custom emoji ID raqamini yuborgan bo'lishi mumkin
  if (msg.text) {
    const trimmed = msg.text.trim();
    if (/^\d{10,25}$/.test(trimmed)) return trimmed;
  }

  // 2) Xabar (yoki forward qilingan xabar) ichida custom_emoji entity bor-yo'qligini tekshiramiz
  const entitySources = [
    { text: msg.text, entities: msg.entities },
    { text: msg.caption, entities: msg.caption_entities }
  ];
  for (const src of entitySources) {
    if (!src.entities) continue;
    const found = src.entities.find(e => e.type === 'custom_emoji' && e.custom_emoji_id);
    if (found) return found.custom_emoji_id;
  }
  return null;
}

// ── TUGMA RANGLARI SOZLAMASI (bonus panel — style: primary/success/danger) ──
function buildStyleListKeyboard(page = 0) {
  const all = getRegisteredButtons();
  const start = page * EMOJI_PAGE_SIZE;
  const pageItems = all.slice(start, start + EMOJI_PAGE_SIZE);

  const styleLabel = (key) => {
    const s = settings.buttonStyles[key] || (all.find(b => b.key === key) || {}).defaultStyle;
    if (s === 'success') return '🟢';
    if (s === 'danger') return '🔴';
    if (s === 'primary') return '🔵';
    return '⚪️';
  };

  const rows = pageItems.map((b, i) => [inlineBtn('admin_style_item', `${styleLabel(b.key)} ${b.label}`, `astyle_${start + i}`)]);

  const navRow = [];
  if (page > 0) navRow.push(inlineBtn('admin_style_prev', '◀️', `astylepage_${page - 1}`));
  if (start + EMOJI_PAGE_SIZE < all.length) navRow.push(inlineBtn('admin_style_next', '▶️', `astylepage_${page + 1}`));
  if (navRow.length) rows.push(navRow);

  rows.push([inlineBtn('admin_back', '◀️ Admin panelga qaytish', 'admin_back')]);
  return Markup.inlineKeyboard(rows);
}

function styleOverviewText() {
  return (
    `🎨 <b>Tugma ranglari sozlamalari</b>\n\n` +
    `🟢 bg_success — muvaffaqiyat / ijobiy holatlar\n` +
    `🔴 bg_danger — xato / xavf / o'chirish\n` +
    `🔵 bg_primary — asosiy, eng ko'p ishlatiladigan\n` +
    `⚪️ — standart (rangsiz)\n\n` +
    `O'zgartirish uchun tugmani tanlang:`
  );
}

function buildStyleItemKeyboard(idx, page) {
  return Markup.inlineKeyboard([
    [
      inlineBtn('admin_style_success', '🟢 Success', `asetstyle_${idx}_success`),
      inlineBtn('admin_style_danger', '🔴 Danger', `asetstyle_${idx}_danger`)
    ],
    [
      inlineBtn('admin_style_primary', '🔵 Primary', `asetstyle_${idx}_primary`),
      inlineBtn('admin_style_none', '⚪️ Standart', `asetstyle_${idx}_none`)
    ],
    [inlineBtn('admin_style_back', '◀️ Ro\'yxatga qaytish', `astylepage_${page}`)]
  ]);
}

function registerAdminHandlers(bot) {
  bot.use(async (ctx, next) => {
    const data = ctx.callbackQuery && ctx.callbackQuery.data;
    if (data && (data.startsWith('admin_') || data.startsWith('rch_') ||
                 data.startsWith('aemoji') || data.startsWith('astyle') || data.startsWith('asetstyle'))) {
      if (!isAdmin(ctx.from.id)) {
        return ctx.answerCbQuery('🚫 Sizda ruxsat yo\'q.', { show_alert: true });
      }
    }
    return next();
  });

  bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    return ctx.reply(adminOverviewText(), { parse_mode: 'HTML', ...refreshAdminPanelMarkup() });
  });

  bot.action('admin_broadcast', async (ctx) => {
    await ctx.answerCbQuery();
    setState(ctx.from.id, { step: 'admin_broadcast' });
    await ctx.reply('📢 Broadcast xabarini yuboring (matn, rasm, video, gif, stiker...):', cancelMenu());
  });

  bot.action('admin_ban', async (ctx) => {
    await ctx.answerCbQuery();
    setState(ctx.from.id, { step: 'admin_ban_user' });
    await ctx.reply('🚫 Ban qilish uchun user ID yoki @username:', cancelMenu());
  });

  bot.action('admin_unban', async (ctx) => {
    await ctx.answerCbQuery();
    setState(ctx.from.id, { step: 'admin_unban_user' });
    await ctx.reply('✅ Unban qilish uchun user ID yoki @username:', cancelMenu());
  });

  bot.action('admin_stats', async (ctx) => {
    await ctx.answerCbQuery();
    const totalVotes = Object.values(battles).reduce((a, b) => a + Object.keys(b.votes).length, 0);
    const text = `📊 <b>Bot Statistikasi</b>\n\n` +
      `👥 Foydalanuvchilar: ${Object.keys(users).length}\n` +
      `🚫 Banlangan: ${Object.values(users).filter(u=>u.banned).length}\n` +
      `🏆 Jami battlelar: ${Object.keys(battles).length}\n` +
      `🟢 Aktiv: ${Object.values(battles).filter(b=>b.active).length}\n` +
      `📦 Jami ovozlar: ${totalVotes}\n` +
      `🎲 #random: ${Object.keys(contests).length}\n` +
      `🥊 #batl (like): ${Object.keys(likebatls).length}\n\n` +
      `📢 Majburiy kanallar:\n${settings.requiredChannels.map(c=>`• ${c}`).join('\n')||'Yo\'q'}`;
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([[inlineBtn('admin_back', '◀️ Orqaga', 'admin_back')]]).reply_markup });
  });

  bot.action('admin_battles', async (ctx) => {
    await ctx.answerCbQuery();
    const all = Object.values(battles);
    let text = `📋 <b>Barcha Battlelar</b> (${all.length})\n\n`;
    if (all.length === 0) { text += 'Hali battle yo\'q.'; }
    else { all.slice(0,20).forEach(b => { const v=Object.keys(b.votes).length; const label = b.text && b.text.trim() ? b.text.substring(0,20) : 'Sir🤫'; text += `${b.active?'🟢':'🔴'} ${label} | ${b.channel} | ${v}${b.target ? '/'+b.target : ''}\n`; }); }
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([[inlineBtn('admin_back', '◀️ Orqaga', 'admin_back')]]).reply_markup });
  });

  bot.action('admin_top10', async (ctx) => {
    await ctx.answerCbQuery();
    const top = topActiveUsers(10);
    let text = `🏅 <b>Top 10 faol foydalanuvchilar</b>\n\n`;
    if (top.length === 0) { text += 'Hali ma\'lumot yo\'q.'; }
    else {
      top.forEach((u, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        text += `${medal} ${u.username ? '@' + u.username : 'ID:' + u.id} — ${u.activityScore || 0} ball\n`;
      });
    }
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([[inlineBtn('admin_back', '◀️ Orqaga', 'admin_back')]]).reply_markup });
  });

  bot.action('admin_back', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(adminOverviewText(), { parse_mode: 'HTML', reply_markup: refreshAdminPanelMarkup().reply_markup });
  });

  bot.action('admin_add_channel', async (ctx) => {
    await ctx.answerCbQuery();
    setState(ctx.from.id, { step: 'admin_add_channel' });
    await ctx.reply('➕ Majburiy kanal username kiriting (@kanal):', cancelMenu());
  });

  bot.action('admin_remove_channel', async (ctx) => {
    await ctx.answerCbQuery();
    if (settings.requiredChannels.length === 0) return ctx.reply('Majburiy kanallar yo\'q.');
    const buttons = settings.requiredChannels.map(ch => [inlineBtn('admin_remove_channel', `❌ ${ch}`, `rch_${ch}`)]);
    await ctx.editMessageText('➖ O\'chirish uchun kanalni tanlang:', { reply_markup: Markup.inlineKeyboard(buttons).reply_markup });
  });

  bot.action(/^rch_(.+)$/, async (ctx) => {
    const ch = ctx.match[1];
    settings.requiredChannels = settings.requiredChannels.filter(c => c !== ch);
    saveSettings();
    await ctx.answerCbQuery(`✅ ${ch} o'chirildi.`);
    await ctx.editMessageText(`✅ ${ch} majburiy kanallardan o'chirildi.`);
  });

  bot.action('admin_toggle_captcha_join', async (ctx) => {
    settings.captchaOnJoin = !settings.captchaOnJoin;
    saveSettings();
    await ctx.answerCbQuery(`Captcha (qatnashish): ${settings.captchaOnJoin ? 'yoqildi ✅' : 'o\'chirildi ⛔'}`);
    try { await ctx.editMessageReplyMarkup(refreshAdminPanelMarkup().reply_markup); } catch (e) {}
  });

  bot.action('admin_toggle_captcha_vote', async (ctx) => {
    settings.captchaOnVote = !settings.captchaOnVote;
    saveSettings();
    await ctx.answerCbQuery(`Captcha (ovoz berish): ${settings.captchaOnVote ? 'yoqildi ✅' : 'o\'chirildi ⛔'}`);
    try { await ctx.editMessageReplyMarkup(refreshAdminPanelMarkup().reply_markup); } catch (e) {}
  });

  bot.action('admin_edit_template', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      `📝 <b>#boshla post dizayni</b>\n\nHozirgi sarlavha:\n${settings.boshlaTemplate.header}\n\nHozirgi pastki matn:\n${settings.boshlaTemplate.footer || '(yo\'q)'}`,
      { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
        [inlineBtn('admin_template_header', '✏️ Sarlavhani o\'zgartirish', 'admin_template_header')],
        [inlineBtn('admin_template_footer', '✏️ Pastki matnni o\'zgartirish', 'admin_template_footer')]
      ]).reply_markup }
    );
  });

  bot.action('admin_template_header', async (ctx) => {
    await ctx.answerCbQuery();
    setState(ctx.from.id, { step: 'admin_edit_template_header' });
    await ctx.reply('✏️ Yangi sarlavha matnini kiriting (HTML teglarga ruxsat: <b>, <i> va h.k.):', cancelMenu());
  });

  bot.action('admin_template_footer', async (ctx) => {
    await ctx.answerCbQuery();
    setState(ctx.from.id, { step: 'admin_edit_template_footer' });
    await ctx.reply('✏️ Yangi pastki matnni kiriting:', cancelMenu());
  });

  bot.action('admin_users_export', async (ctx) => {
    await ctx.answerCbQuery();
    try {
      const tmpPath = path.join(require('os').tmpdir(), `users_export_${Date.now()}.json`);
      await fs.writeJson(tmpPath, users, { spaces: 2 });
      await ctx.replyWithDocument(
        { source: tmpPath, filename: 'users.json' },
        { caption: `📤 Users export\n👥 Jami: ${Object.keys(users).length} ta foydalanuvchi` }
      );
      fs.remove(tmpPath).catch(() => {});
    } catch (e) {
      await ctx.reply(`❌ Export xato: ${e.message}`);
    }
  });

  bot.action('admin_users_import', async (ctx) => {
    await ctx.answerCbQuery();
    setState(ctx.from.id, { step: 'admin_users_import' });
    await ctx.reply(
      '📥 users.json faylini yuboring.\n\n' +
      '⚠️ Diqqat: fayl ichidagi barcha foydalanuvchilar joriy bazaga qo\'shiladi ' +
      '(mavjud ID lar yangi ma\'lumot bilan almashtiriladi, boshqalar saqlanib qoladi).',
      cancelMenu()
    );
  });

  // ============================================================
  //                     💾 BACKUP OLISH
  //   Barcha data/*.json fayllarni (users, battles, contests,
  //   likebatls, settings, templates) alohida hujjat sifatida
  //   adminga yuboradi. Tashqi zip vositasiga bog'liq emas.
  // ============================================================
  bot.action('admin_backup', async (ctx) => {
    await ctx.answerCbQuery();
    const { flushAllSyncNow } = require('../db');
    flushAllSyncNow(); // navbatdagi debounce yozishlarni ham diskka yozib qo'yish

    const dataDir = path.join(__dirname, '..', '..', 'data');
    const stamp = new Date().toISOString().slice(0, 10);
    await ctx.reply('💾 Backup tayyorlanmoqda...');

    let sent = 0;
    for (const name of ['users.json', 'battles.json', 'contests.json', 'likebatls.json', 'settings.json', 'templates.json']) {
      const filePath = path.join(dataDir, name);
      if (!fs.existsSync(filePath)) continue;
      try {
        await ctx.replyWithDocument({ source: filePath, filename: `${stamp}_${name}` });
        sent++;
      } catch (e) { console.log('[BACKUP] xato:', name, e.message); }
    }
    await ctx.reply(sent > 0 ? `✅ Backup tayyor — ${sent} ta fayl yuborildi.` : '❌ Backup uchun fayl topilmadi.', mainMenu());
  });

  // ============================================================
  //           🧩 MINI APP CAPTCHA SOZLAMASI
  //   Urinishlar soni va bloklash muddatini o'zgartirish.
  // ============================================================
  function captchaSettingsText() {
    const cfg = settings.miniAppCaptcha;
    return `🧩 <b>Mini App captcha sozlamasi</b>\n\n` +
      `Foydalanuvchi Mini App'ga birinchi marta kirganda oddiy matematik savolga javob berishi kerak.\n\n` +
      `🔁 Urinishlar soni: <b>${cfg.maxAttempts}</b>\n` +
      `⏱ Bloklash muddati: <b>${cfg.blockMinutes} daqiqa</b>`;
  }
  function captchaSettingsKeyboard() {
    return Markup.inlineKeyboard([
      [inlineBtn('admin_captcha_attempts', '🔁 Urinishlar sonini o\'zgartirish', 'admin_captcha_attempts')],
      [inlineBtn('admin_captcha_block', '⏱ Bloklash muddatini o\'zgartirish', 'admin_captcha_block')],
      [inlineBtn('admin_back', '◀️ Admin panelga qaytish', 'admin_back')]
    ]);
  }

  bot.action('admin_miniapp_captcha', async (ctx) => {
    await ctx.answerCbQuery();
    try { await ctx.editMessageText(captchaSettingsText(), { parse_mode: 'HTML', reply_markup: captchaSettingsKeyboard().reply_markup }); }
    catch (e) { await ctx.reply(captchaSettingsText(), { parse_mode: 'HTML', reply_markup: captchaSettingsKeyboard().reply_markup }); }
  });

  bot.action('admin_captcha_attempts', async (ctx) => {
    await ctx.answerCbQuery();
    setState(ctx.from.id, { step: 'admin_captcha_attempts' });
    await ctx.reply(`🔁 Yangi urinishlar sonini kiriting (hozir: ${settings.miniAppCaptcha.maxAttempts}):`, cancelMenu());
  });

  bot.action('admin_captcha_block', async (ctx) => {
    await ctx.answerCbQuery();
    setState(ctx.from.id, { step: 'admin_captcha_block' });
    await ctx.reply(`⏱ Yangi bloklash muddatini daqiqalarda kiriting (hozir: ${settings.miniAppCaptcha.blockMinutes} daqiqa):`, cancelMenu());
  });

  // ============================================================
  //                😀 CUSTOM EMOJI SOZLAMALARI PANELI
  //   Eslatma: callback_data'da tugma KALITI emas, ro'yxatdagi INDEKS
  //   ishlatiladi — chunki ko'p kalitda "_" bor (masalan "lb_setup_open"),
  //   va oldingi "aemoji_<key>_<page>" formati regex bilan noto'g'ri
  //   bo'linib, tugma hech narsaga javob bermas edi.
  // ============================================================
  bot.action('admin_emoji_settings', async (ctx) => {
    await ctx.answerCbQuery();
    try { await ctx.editMessageText(emojiOverviewText(), { parse_mode: 'HTML', reply_markup: buildEmojiListKeyboard(0).reply_markup }); }
    catch (e) { await ctx.reply(emojiOverviewText(), { parse_mode: 'HTML', reply_markup: buildEmojiListKeyboard(0).reply_markup }); }
  });

  bot.action(/^aemojipage_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const page = parseInt(ctx.match[1], 10);
    try { await ctx.editMessageText(emojiOverviewText(), { parse_mode: 'HTML', reply_markup: buildEmojiListKeyboard(page).reply_markup }); } catch (e) {}
  });

  bot.action(/^aemoji_(\d+)$/, async (ctx) => {
    const idx = parseInt(ctx.match[1], 10);
    const btnDef = getRegisteredButtons()[idx];
    if (!btnDef) return ctx.answerCbQuery('❌ Tugma topilmadi.', { show_alert: true });
    await ctx.answerCbQuery();
    const page = Math.floor(idx / EMOJI_PAGE_SIZE);
    setState(ctx.from.id, { step: 'admin_emoji_wait', buttonKey: btnDef.key, page });
    try {
      await ctx.editMessageText(buildEmojiItemText(btnDef), { parse_mode: 'HTML', reply_markup: buildEmojiItemKeyboard(btnDef, page, idx).reply_markup });
    } catch (e) {
      await ctx.reply(buildEmojiItemText(btnDef), { parse_mode: 'HTML', reply_markup: buildEmojiItemKeyboard(btnDef, page, idx).reply_markup });
    }
  });

  bot.action(/^aemojiclear_(\d+)$/, async (ctx) => {
    const idx = parseInt(ctx.match[1], 10);
    const btnDef = getRegisteredButtons()[idx];
    if (!btnDef) return ctx.answerCbQuery('❌ Tugma topilmadi.', { show_alert: true });
    delete settings.buttonEmojis[btnDef.key];
    saveSettings();
    await ctx.answerCbQuery('🗑 Tozalandi.');
    clearState(ctx.from.id);
    const page = Math.floor(idx / EMOJI_PAGE_SIZE);
    try { await ctx.editMessageText(emojiOverviewText(), { parse_mode: 'HTML', reply_markup: buildEmojiListKeyboard(page).reply_markup }); } catch (e) {}
  });

  // ============================================================
  //                🎨 TUGMA RANGLARI SOZLAMALARI PANELI
  //   (admin panelidagi qo'shimcha imkoniyat — istalgan tugma
  //   rangini istalgan vaqt qayta sozlash uchun)
  // ============================================================
  bot.command('renglar', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.reply(styleOverviewText(), { parse_mode: 'HTML', reply_markup: buildStyleListKeyboard(0).reply_markup });
  });

  bot.action(/^astylepage_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const page = parseInt(ctx.match[1], 10);
    try { await ctx.editMessageText(styleOverviewText(), { parse_mode: 'HTML', reply_markup: buildStyleListKeyboard(page).reply_markup }); }
    catch (e) { await ctx.reply(styleOverviewText(), { parse_mode: 'HTML', reply_markup: buildStyleListKeyboard(page).reply_markup }); }
  });

  bot.action(/^astyle_(\d+)$/, async (ctx) => {
    const idx = parseInt(ctx.match[1], 10);
    const btnDef = getRegisteredButtons()[idx];
    if (!btnDef) return ctx.answerCbQuery('❌ Tugma topilmadi.', { show_alert: true });
    await ctx.answerCbQuery();
    const page = Math.floor(idx / EMOJI_PAGE_SIZE);
    try {
      await ctx.editMessageText(`🎨 <b>${btnDef.label}</b>\n\nYangi rangni tanlang:`, { parse_mode: 'HTML', reply_markup: buildStyleItemKeyboard(idx, page).reply_markup });
    } catch (e) {}
  });

  bot.action(/^asetstyle_(\d+)_(success|danger|primary|none)$/, async (ctx) => {
    const idx = parseInt(ctx.match[1], 10);
    const style = ctx.match[2];
    const btnDef = getRegisteredButtons()[idx];
    if (!btnDef) return ctx.answerCbQuery('❌ Tugma topilmadi.', { show_alert: true });
    const page = Math.floor(idx / EMOJI_PAGE_SIZE);
    settings.buttonStyles[btnDef.key] = style === 'none' ? null : style;
    saveSettings();
    await ctx.answerCbQuery('✅ Rang o\'zgartirildi.');
    try { await ctx.editMessageText(styleOverviewText(), { parse_mode: 'HTML', reply_markup: buildStyleListKeyboard(page).reply_markup }); } catch (e) {}
  });

  bot.on(['photo', 'video', 'animation', 'sticker', 'document', 'voice', 'audio'], async (ctx, next) => {
    const state = getState(ctx.from.id);
    if (!state) return next();

    if (state.step === 'admin_users_import') {
      if (!ctx.message.document) {
        await ctx.reply('❌ Iltimos, .json fayl yuboring (document sifatida).', cancelMenu());
        return;
      }
      const doc = ctx.message.document;
      if (!doc.file_name || !doc.file_name.toLowerCase().endsWith('.json')) {
        await ctx.reply('❌ Fayl kengaytmasi .json bo\'lishi kerak.', cancelMenu());
        return;
      }
      try {
        const link = await ctx.telegram.getFileLink(doc.file_id);
        const raw = await downloadAsText(link.href || link);
        const imported = JSON.parse(raw);

        if (typeof imported !== 'object' || imported === null || Array.isArray(imported)) {
          throw new Error('JSON tarkibi noto\'g\'ri (obyekt kutilgan: { "userId": {...} }).');
        }

        let added = 0, updated = 0;
        for (const [uid, data] of Object.entries(imported)) {
          if (!data || typeof data !== 'object') continue;
          if (users[uid]) updated++; else added++;
          users[uid] = { ...(users[uid] || {}), ...data };
        }
        saveUsers();
        clearState(ctx.from.id);
        await ctx.reply(
          `✅ Import muvaffaqiyatli!\n\n➕ Yangi: ${added}\n♻️ Yangilangan: ${updated}\n👥 Jami hozir: ${Object.keys(users).length}`,
          mainMenu()
        );
      } catch (e) {
        await ctx.reply(`❌ Import xato: ${e.message}`, mainMenu());
        clearState(ctx.from.id);
      }
      return;
    }

    return next();
  });

  // Forward/to'g'ridan-to'g'ri yuborilgan custom-emoji xabarini qabul qilish
  // (matn ustida ham entity bo'lishi mumkin, shuning uchun bu HAR TURDAGI
  // xabarga ishlaydigan alohida middleware sifatida qo'yiladi).
  bot.on('message', async (ctx, next) => {
    const state = getState(ctx.from.id);
    if (!state || state.step !== 'admin_emoji_wait') return next();
    if (!isAdmin(ctx.from.id)) return next();

    const emojiId = extractCustomEmojiId(ctx);
    const btnDef = getRegisteredButtons().find(b => b.key === state.buttonKey);
    if (!btnDef) { clearState(ctx.from.id); return next(); }

    if (!emojiId) {
      await ctx.reply('❌ Bu xabarda custom emoji topilmadi. Premium emoji ishtirok etgan xabar yuboring yoki ID raqamini kiriting.', cancelMenu());
      return;
    }

    settings.buttonEmojis[btnDef.key] = emojiId;
    saveSettings();
    const page = state.page || 0;
    clearState(ctx.from.id);

    await ctx.reply(`✅ <b>${btnDef.label}</b> uchun custom emoji sozlandi!`, { parse_mode: 'HTML', ...mainMenu() });
    await ctx.reply(emojiOverviewText(), { parse_mode: 'HTML', reply_markup: buildEmojiListKeyboard(page).reply_markup });
  });
}

// Telegram file-link'dan matnni yuklab olish (tashqi paketsiz, https bilan)
function downloadAsText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Faylni yuklab bo'lmadi (HTTP ${res.statusCode})`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// Admin bilan bog'liq matnli holatlar — markaziy text handlerdan chaqiriladi
async function handleAdminTextState(ctx, state) {
  const text = ctx.message.text.trim();

  // Eslatma: 'admin_emoji_wait' holati bu yerda emas, admin.js dagi
  // bot.on('message', ...) middlewarida to'liq ishlanadi (u markaziy
  // 'text' handlerdan OLDIN ro'yxatdan o'tadi va shu step uchun next()
  // chaqirmaydi, shuning uchun bu funksiyaga umuman yetib kelmaydi).

  if (state.step === 'admin_captcha_attempts') {
    const n = parseInt(text, 10);
    if (isNaN(n) || n < 1 || n > 20) { await ctx.reply('❌ 1 dan 20 gacha son kiriting.', cancelMenu()); return true; }
    settings.miniAppCaptcha.maxAttempts = n;
    saveSettings();
    clearState(ctx.from.id);
    await ctx.reply(`✅ Urinishlar soni ${n} ga o'zgartirildi.`, mainMenu());
    return true;
  }

  if (state.step === 'admin_captcha_block') {
    const n = parseInt(text, 10);
    if (isNaN(n) || n < 1 || n > 10080) { await ctx.reply('❌ 1 dan 10080 (7 kun) gacha daqiqa kiriting.', cancelMenu()); return true; }
    settings.miniAppCaptcha.blockMinutes = n;
    saveSettings();
    clearState(ctx.from.id);
    await ctx.reply(`✅ Bloklash muddati ${n} daqiqaga o'zgartirildi.`, mainMenu());
    return true;
  }

  if (state.step === 'admin_edit_template_header') {
    settings.boshlaTemplate.header = text;
    saveSettings();
    clearState(ctx.from.id);
    await ctx.reply('✅ Battle post sarlavhasi yangilandi.', mainMenu());
    return true;
  }

  if (state.step === 'admin_edit_template_footer') {
    settings.boshlaTemplate.footer = text;
    saveSettings();
    clearState(ctx.from.id);
    await ctx.reply('✅ Battle post pastki matni yangilandi.', mainMenu());
    return true;
  }

  if (state.step === 'admin_ban_user') {
    const target = findUserByQuery(text);
    if (!target) { clearState(ctx.from.id); await ctx.reply('❌ Topilmadi.', mainMenu()); return true; }
    users[String(target.id)].banned = true;
    saveUsers();
    clearState(ctx.from.id);
    await ctx.reply(`🚫 @${target.username || target.id} ban qilindi.`, mainMenu());
    return true;
  }

  if (state.step === 'admin_unban_user') {
    const target = findUserByQuery(text);
    if (!target) { clearState(ctx.from.id); await ctx.reply('❌ Topilmadi.', mainMenu()); return true; }
    users[String(target.id)].banned = false;
    saveUsers();
    clearState(ctx.from.id);
    await ctx.reply(`✅ @${target.username || target.id} unban qilindi.`, mainMenu());
    return true;
  }

  if (state.step === 'admin_add_channel') {
    let ch = text;
    if (!ch.startsWith('@')) ch = '@' + ch;
    if (!settings.requiredChannels.includes(ch)) { settings.requiredChannels.push(ch); saveSettings(); }
    clearState(ctx.from.id);
    await ctx.reply(`✅ ${ch} majburiy kanallarga qo'shildi.`, mainMenu());
    return true;
  }

  if (state.step === 'admin_remove_channel') {
    let ch = text;
    if (!ch.startsWith('@')) ch = '@' + ch;
    settings.requiredChannels = settings.requiredChannels.filter(c => c !== ch);
    saveSettings();
    clearState(ctx.from.id);
    await ctx.reply(`✅ ${ch} o'chirildi.`, mainMenu());
    return true;
  }

  return false;
}

module.exports = { registerAdminHandlers, handleAdminTextState, sendBroadcast, adminOverviewText };
