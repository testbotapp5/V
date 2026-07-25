const { Markup } = require('telegraf');
const { settings } = require('./db');
const { WEBAPP_URL } = require('./config');
const { registerButton, inlineBtn, replyBtn, webAppBtn } = require('./buttons');

// ── ASOSIY MENYU TUGMALARI (reply keyboard) ──
registerButton('menu_create_battle',  '🏆 Battle yaratish', 'primary');
registerButton('menu_my_battles',     '📋 Mening ovoz battlelarim', 'primary');
registerButton('menu_create_contest', '➕ Konkurs yaratish', 'primary');
registerButton('menu_my_contests',    '🎲 Mening konkurslarim', 'primary');
registerButton('menu_create_likebatl','➕ Like battle yaratish', 'primary');
registerButton('menu_my_likebatls',   '🥊 Mening like battlelarim', 'primary');
registerButton('menu_stats',          '📊 Statistika', 'primary');
registerButton('menu_help',           'ℹ️ Yordam', 'primary');
registerButton('menu_cancel',         '❌ Bekor qilish', 'danger');
registerButton('menu_webapp',         '💁‍♂️Tezkor yaratish', 'success');

const mainMenu = () => {
  const rows = [
    [replyBtn('menu_create_battle', '🏆 Battle yaratish'), replyBtn('menu_my_battles', '📋 Mening ovoz battlelarim')],
    [replyBtn('menu_create_contest', '➕ Konkurs yaratish'), replyBtn('menu_my_contests', '🎲 Mening konkurslarim')],
    [replyBtn('menu_create_likebatl', '➕ Like battle yaratish'), replyBtn('menu_my_likebatls', '🥊 Mening like battlelarim')],
    [replyBtn('menu_stats', '📊 Statistika'), replyBtn('menu_help', 'ℹ️ Yordam')]
  ];
  // Faqat WEBAPP_URL sozlangan bo'lsa ko'rsatamiz (aks holda Telegram tugmani rad etadi)
  if (WEBAPP_URL) {
    rows.push([webAppBtn('menu_webapp', '💁\u200d♂️Tezkor yaratish', WEBAPP_URL)]);
  }
  return Markup.keyboard(rows).resize();
};

const cancelMenu = () => Markup.keyboard([[replyBtn('menu_cancel', '❌ Bekor qilish')]]).resize();

// ── ADMIN PANEL TUGMALARI (inline) ──
registerButton('admin_broadcast',        '📢 Broadcast', 'primary');
registerButton('admin_ban',              '🚫 Ban', 'danger');
registerButton('admin_unban',            '✅ Unban', 'success');
registerButton('admin_stats',            '📊 Statistika', 'primary');
registerButton('admin_battles',          '📋 Battlelar', 'primary');
registerButton('admin_top10',            '🏅 Top 10 faol user', 'primary');
registerButton('admin_add_channel',      '➕ Kanal qo\'shish', 'success');
registerButton('admin_remove_channel',   '➖ Kanal o\'chirish', 'danger');
registerButton('admin_edit_template',    '📝 #boshla post dizayni', 'primary');
registerButton('admin_users_export',     '📤 Users export', 'primary');
registerButton('admin_users_import',     '📥 Users import', 'primary');
registerButton('admin_toggle_captcha_join', '🤖 Captcha (qatnashish)', 'primary');
registerButton('admin_toggle_captcha_vote', '🤖 Captcha (ovoz berish)', 'primary');
registerButton('admin_emoji_settings',   '😀 Custom Emoji sozlamalari', 'primary');
registerButton('admin_backup',           '💾 Backup olish', 'success');
registerButton('admin_miniapp_captcha',  '🧩 Mini App captcha sozlamasi', 'primary');

const adminPanel = () => Markup.inlineKeyboard([
  [inlineBtn('admin_broadcast', '📢 Broadcast', 'admin_broadcast')],
  [inlineBtn('admin_ban', '🚫 Ban', 'admin_ban'), inlineBtn('admin_unban', '✅ Unban', 'admin_unban')],
  [inlineBtn('admin_stats', '📊 Statistika', 'admin_stats')],
  [inlineBtn('admin_battles', '📋 Battlelar', 'admin_battles')],
  [inlineBtn('admin_top10', '🏅 Top 10 faol user', 'admin_top10')],
  [inlineBtn('admin_add_channel', '➕ Kanal qo\'shish', 'admin_add_channel'),
   inlineBtn('admin_remove_channel', '➖ Kanal o\'chirish', 'admin_remove_channel')],
  [inlineBtn('admin_edit_template', '📝 #boshla post dizayni', 'admin_edit_template')],
  [inlineBtn('admin_users_export', '📤 Users export', 'admin_users_export'),
   inlineBtn('admin_users_import', '📥 Users import', 'admin_users_import')],
  [inlineBtn(
    'admin_toggle_captcha_join',
    `🤖 Captcha (qatnashish): ${settings.captchaOnJoin ? 'ON ✅' : 'OFF ⛔'}`,
    'admin_toggle_captcha_join'
  )],
  [inlineBtn(
    'admin_toggle_captcha_vote',
    `🤖 Captcha (ovoz berish): ${settings.captchaOnVote ? 'ON ✅' : 'OFF ⛔'}`,
    'admin_toggle_captcha_vote'
  )],
  [inlineBtn('admin_emoji_settings', '😀 Custom Emoji sozlamalari', 'admin_emoji_settings')],
  [inlineBtn('admin_miniapp_captcha', '🧩 Mini App captcha sozlamasi', 'admin_miniapp_captcha')],
  [inlineBtn('admin_backup', '💾 Backup olish', 'admin_backup')]
]);

module.exports = { mainMenu, cancelMenu, adminPanel };
