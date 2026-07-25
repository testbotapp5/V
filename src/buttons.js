// ============================================================
//   MARKAZLASHGAN TUGMA YORDAMCHISI
//   Barcha tugmalar (inline VA reply-keyboard) shu yerdan yasaladi,
//   shunda ranglar (style) va custom premium emoji (icon_custom_emoji_id)
//   bitta joydan boshqariladi va /admin panelida sozlanadi.
//
//   Bot API 9.4+ (9 fevral, 2026):
//     style               — 'primary' (ko'k) | 'success' (yashil) | 'danger' (qizil)
//     icon_custom_emoji_id — tugma matni oldida chiqadigan custom emoji ID
//   Eslatma: icon_custom_emoji_id faqat bot egasi Telegram Premium bo'lsa
//   yoki bot Fragment orqali qo'shimcha username sotib olgan bo'lsa ishlaydi.
// ============================================================

const { settings } = require('./db');

// Har bir statik tugma shu yerda BIR MARTA ro'yxatdan o'tadi:
//   key         — /admin panelida sozlash uchun barqaror identifikator
//   label       — admin panelida ko'rinadigan odam o'qiy oladigan nom
//   defaultStyle— agar admin hali sozlamagan bo'lsa ishlatiladigan standart rang
// Registr shu faylda to'ldiriladi (registerButton chaqiruvlari orqali,
// har bir modul o'zining tugmalarini shu yerga "e'lon qiladi").
const REGISTRY = {}; // key -> { key, label, defaultStyle }

function registerButton(key, label, defaultStyle) {
  if (!REGISTRY[key]) {
    REGISTRY[key] = { key, label, defaultStyle: defaultStyle || null };
  }
  return key;
}

function getRegisteredButtons() {
  return Object.values(REGISTRY);
}

function getButtonStyle(key) {
  const custom = settings.buttonStyles ? settings.buttonStyles[key] : undefined;
  if (custom === null) return undefined; // admin ataylab "standart" (rangsiz) qilib qo'ygan
  if (custom) return custom;
  const def = REGISTRY[key];
  return (def && def.defaultStyle) || undefined;
}

function getButtonEmoji(key) {
  const id = settings.buttonEmojis ? settings.buttonEmojis[key] : undefined;
  return id || undefined;
}

// ── INLINE TUGMA (callback_data) ──
function inlineBtn(key, text, callbackData) {
  const btn = { text, callback_data: callbackData };
  const style = getButtonStyle(key);
  const emoji = getButtonEmoji(key);
  if (style) btn.style = style;
  if (emoji) btn.icon_custom_emoji_id = emoji;
  return btn;
}

// ── INLINE TUGMA (url) ──
function inlineUrlBtn(key, text, url) {
  const btn = { text, url };
  const style = getButtonStyle(key);
  const emoji = getButtonEmoji(key);
  if (style) btn.style = style;
  if (emoji) btn.icon_custom_emoji_id = emoji;
  return btn;
}

// ── REPLY KEYBOARD TUGMASI (pastdagi asosiy menyu) ──
function replyBtn(key, text) {
  const btn = { text };
  const style = getButtonStyle(key);
  const emoji = getButtonEmoji(key);
  if (style) btn.style = style;
  if (emoji) btn.icon_custom_emoji_id = emoji;
  return btn;
}

// ── MINI APP OCHUVCHI TUGMA (reply keyboard, web_app turi) ──
// Bot API 9.4+ da "style" maydoni tugmani ochuvchi boshqa maydonlar
// (url, callback_data, web_app va h.k.) bilan bir qatorda ishlatilishi
// mumkin — hujjatlarda faqat o'sha "turini belgilovchi" maydonlardan
// FAQAT BITTASI ishlatilishi kerakligi aytilgan, "style" esa shu
// cheklovdan alohida (u har doim qo'shimcha bo'lib qo'llanadi).
// Shu sabab web_app tugmasiga ham xuddi boshqalari kabi style beriladi.
function webAppBtn(key, text, url) {
  const btn = { text, web_app: { url } };
  const style = getButtonStyle(key);
  const emoji = getButtonEmoji(key);
  if (style) btn.style = style;
  if (emoji) btn.icon_custom_emoji_id = emoji;
  return btn;
}

module.exports = {
  registerButton,
  getRegisteredButtons,
  getButtonStyle,
  getButtonEmoji,
  inlineBtn,
  inlineUrlBtn,
  replyBtn,
  webAppBtn
};
