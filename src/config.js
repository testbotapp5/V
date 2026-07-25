require('dotenv').config();

const BOT_TOKEN    = process.env.BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME;
const ADMIN_IDS    = (process.env.ADMIN_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);
const WEBAPP_URL = process.env.WEBAPP_URL || '';
const PORT = parseInt(process.env.PORT, 10) || 3000;

if (!BOT_TOKEN || !BOT_USERNAME) {
  console.error('❌ .env faylida BOT_TOKEN va BOT_USERNAME bo\'lishi kerak!');
  process.exit(1);
}

if (ADMIN_IDS.length === 0) {
  console.warn('⚠️  .env faylida ADMIN_IDS belgilanmagan! Hech kim /admin panelga kira olmaydi.');
}

if (!WEBAPP_URL) {
  console.warn('⚠️  .env faylida WEBAPP_URL belgilanmagan! "🚀 Tezroq yaratish" Mini App tugmasi ko\'rinmaydi.');
}

function isAdmin(userId) {
  return ADMIN_IDS.includes(String(userId));
}

// Loyiha vaqti GMT+5 (Toshkent) bo'yicha ishlaydi.
const TIMEZONE_OFFSET_MINUTES = 5 * 60;

module.exports = {
  BOT_TOKEN,
  BOT_USERNAME,
  ADMIN_IDS,
  isAdmin,
  TIMEZONE_OFFSET_MINUTES,
  WEBAPP_URL,
  PORT
};
