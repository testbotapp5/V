const fs = require('fs-extra');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.ensureDirSync(DATA_DIR);

const FILES = {
  users:     path.join(DATA_DIR, 'users.json'),
  battles:   path.join(DATA_DIR, 'battles.json'),    // #boshla — ovoz battle
  contests:  path.join(DATA_DIR, 'contests.json'),   // #random — random konkurs
  likebatls: path.join(DATA_DIR, 'likebatls.json'),  // #batl — like battle
  settings:  path.join(DATA_DIR, 'settings.json'),
  templates: path.join(DATA_DIR, 'templates.json'),  // saqlangan battle/konkurs shablonlari
  archive:   path.join(DATA_DIR, 'archive.json')     // eski tugallangan battle/contest/likebatl arxivi
};

const DEFAULTS = {
  users: {},
  battles: {},
  contests: {},
  likebatls: {},
  templates: {},
  archive: { battles: {}, contests: {}, likebatls: {} },
  settings: {
    requiredChannels: [],
    captchaOnJoin: false,
    captchaOnVote: false,
    boshlaTemplate: {
      header: '🏆 BATL Boshlandi🥳',
      footer: ''
    },
    // Tugma ranglari (Bot API 9.4+ "style" maydoni: primary/success/danger).
    // buttonKey -> 'primary' | 'success' | 'danger' | null (null = standart/o'chirilgan)
    buttonStyles: {},
    // Custom premium emoji (Bot API 9.4+ "icon_custom_emoji_id" maydoni).
    // buttonKey -> custom_emoji_id (string) | undefined (sozlanmagan)
    buttonEmojis: {},
    // Mini App'ga birinchi kirishda captcha: urinishlar soni va bloklash
    // muddati admin panelda o'zgartiriladi.
    miniAppCaptcha: {
      maxAttempts: 5,
      blockMinutes: 60
    }
  }
};

function loadSync(key) {
  const file = FILES[key];
  try {
    if (!fs.existsSync(file)) {
      fs.writeJsonSync(file, DEFAULTS[key], { spaces: 2 });
      return JSON.parse(JSON.stringify(DEFAULTS[key]));
    }
    return fs.readJsonSync(file);
  } catch (e) {
    console.error(`[DB] ${key} o'qishda xato:`, e.message);
    return JSON.parse(JSON.stringify(DEFAULTS[key]));
  }
}

// ============================================================
//   SAQLASH: debounce qilingan asinxron yozish.
//   Sinxron writeJsonSync har chaqiruvda event-loopni bloklardi;
//   endi bir necha yaqin saqlashlar bitta yozishga birlashtiriladi,
//   va yozish asinxron (fs.writeJson) bajariladi.
// ============================================================
const pendingSaves = {};   // key -> true (navbatda kutayotgan yozish bormi)
const saveTimers = {};     // key -> setTimeout handle
const SAVE_DEBOUNCE_MS = 150;

function flushSave(key, data) {
  fs.writeJson(FILES[key], data, { spaces: 2 }, (e) => {
    if (e) console.error(`[DB] ${key} saqlashda xato:`, e.message);
  });
  pendingSaves[key] = false;
  saveTimers[key] = null;
}

function saveDebounced(key, getData) {
  pendingSaves[key] = true;
  if (saveTimers[key]) return; // allaqachon navbatda bor
  saveTimers[key] = setTimeout(() => flushSave(key, getData()), SAVE_DEBOUNCE_MS);
}

// Dastur to'xtaganda (SIGINT/SIGTERM) navbatdagi o'zgarishlar diskka
// yozilishini kafolatlash uchun darhol (sinxron) yozib qo'yamiz.
function flushAllSyncNow() {
  const getters = {
    users: () => users,
    battles: () => battles,
    contests: () => contests,
    likebatls: () => likebatls,
    settings: () => settings,
    templates: () => templates,
    archive: () => archive
  };
  for (const key of Object.keys(getters)) {
    if (!pendingSaves[key]) continue;
    try {
      if (saveTimers[key]) { clearTimeout(saveTimers[key]); saveTimers[key] = null; }
      fs.writeJsonSync(FILES[key], getters[key](), { spaces: 2 });
      pendingSaves[key] = false;
    } catch (e) {
      console.error(`[DB] ${key} yakuniy saqlashda xato:`, e.message);
    }
  }
}

const users     = loadSync('users');
const battles   = loadSync('battles');
const contests  = loadSync('contests');
const likebatls = loadSync('likebatls');
const settings  = loadSync('settings');
const templates = loadSync('templates');
const archive   = loadSync('archive');
if (!archive.battles) archive.battles = {};
if (!archive.contests) archive.contests = {};
if (!archive.likebatls) archive.likebatls = {};

// Eski versiyalardan migratsiya — yangi maydonlar yo'q bo'lsa default qo'shamiz
if (!settings.boshlaTemplate) {
  settings.boshlaTemplate = { header: '🏆 BATL Boshlandi🥳', footer: '' };
}
if (settings.captchaOnJoin === undefined) settings.captchaOnJoin = false;
if (settings.captchaOnVote === undefined) settings.captchaOnVote = false;
if (!Array.isArray(settings.requiredChannels)) settings.requiredChannels = [];
if (!settings.buttonStyles || typeof settings.buttonStyles !== 'object') settings.buttonStyles = {};
if (!settings.buttonEmojis || typeof settings.buttonEmojis !== 'object') settings.buttonEmojis = {};
if (!settings.miniAppCaptcha || typeof settings.miniAppCaptcha !== 'object') {
  settings.miniAppCaptcha = { maxAttempts: 5, blockMinutes: 60 };
}
if (!settings.miniAppCaptcha.maxAttempts) settings.miniAppCaptcha.maxAttempts = 5;
if (!settings.miniAppCaptcha.blockMinutes) settings.miniAppCaptcha.blockMinutes = 60;

const saveUsers     = () => saveDebounced('users', () => users);
const saveBattles   = () => saveDebounced('battles', () => battles);
const saveContests  = () => saveDebounced('contests', () => contests);
const saveLikebatls = () => saveDebounced('likebatls', () => likebatls);
const saveSettings  = () => saveDebounced('settings', () => settings);
const saveTemplates = () => saveDebounced('templates', () => templates);
const saveArchive   = () => saveDebounced('archive', () => archive);

module.exports = {
  users, battles, contests, likebatls, settings, templates, archive,
  saveUsers, saveBattles, saveContests, saveLikebatls, saveSettings, saveTemplates, saveArchive,
  flushAllSyncNow
};
