const cron = require('node-cron');
const path = require('path');
const fs = require('fs-extra');
const {
  battles, contests, likebatls, saveBattles, saveContests, saveLikebatls,
  users, saveUsers, flushAllSyncNow, archive, saveArchive
} = require('./db');
const { isMemberOf } = require('./helpers');
const { ADMIN_IDS } = require('./config');
const { declareWinner, stopBattleNoWinner, getVotesForParticipant, updateBattlePost } = require('./modules/voteBattle');
const { finishRandomContest, publishContestNow } = require('./modules/randomContest');

// ============================================================
//   HAR 5 DAQIQADA: ovoz berganlarning kanal a'zoligini tekshirish.
//   Kanaldan chiqib ketgan bo'lsa — ovozi bekor qilinadi (-1).
//   Rate-limit (429) xavfini kamaytirish uchun so'rovlar kichik
//   guruhlarda (CONCURRENCY) ketma-ket-parallel bajariladi, hammasi
//   birdan emas.
// ============================================================
const RECHECK_CONCURRENCY = 8;

async function runWithConcurrency(items, worker, limit) {
  const queue = [...items];
  const runners = new Array(Math.min(limit, queue.length)).fill(null).map(async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function recheckVoterSubscriptions(bot) {
  for (const battle of Object.values(battles)) {
    if (!battle.active) continue;
    const voterIds = Object.keys(battle.votes || {});
    if (voterIds.length === 0) continue;

    let changed = false;
    await runWithConcurrency(voterIds, async (voterId) => {
      const stillMember = await isMemberOf(bot, Number(voterId), battle.channel);
      if (!stillMember && battle.votes[voterId]) {
        const targetUserId = battle.votes[voterId].targetUserId;
        delete battle.votes[voterId];
        changed = true;

        if (users[voterId]) {
          users[voterId].votes = Math.max(0, (users[voterId].votes || 0) - 1);
          saveUsers();
        }

        console.log(`[CRON] Ovoz bekor qilindi: voter=${voterId} target=${targetUserId} battle=${battle.battleId} (kanaldan chiqib ketgan)`);
      }
    }, RECHECK_CONCURRENCY);

    if (changed) {
      saveBattles();
      await updateBattlePost(bot, battle);
    }
  }
}

// ============================================================
//   "AXLATLARNI" TOZALASH (Garbage Collection):
//   Tugagan (active=false) va ma'lum muddatdan beri tegilmagan
//   battle/contest/likebatl'lar asosiy fayldan arxivga ko'chiriladi.
//   Bu asosiy JSON fayllarni kichik va tez saqlaydi (bot tezligi
//   ko'p jihatdan shu fayllarning hajmiga bog'liq, chunki har bir
//   saqlashda butun fayl qayta yoziladi).
// ============================================================
const ARCHIVE_AFTER_MS = 14 * 24 * 60 * 60 * 1000; // 14 kun

function finishedAt(item) {
  return item.finishedAt || item.createdAt || 0;
}

async function runGarbageCollection(bot) {
  const now = Date.now();
  let archivedCount = 0;

  for (const [id, b] of Object.entries(battles)) {
    if (b.active) continue;
    if (now - finishedAt(b) < ARCHIVE_AFTER_MS) continue;
    archive.battles[id] = b;
    delete battles[id];
    archivedCount++;
  }

  for (const [id, c] of Object.entries(contests)) {
    if (c.active || c.pendingPublish) continue;
    if (now - finishedAt(c) < ARCHIVE_AFTER_MS) continue;
    archive.contests[id] = c;
    delete contests[id];
    archivedCount++;
  }

  for (const [id, lb] of Object.entries(likebatls)) {
    if (lb.active) continue;
    if (now - finishedAt(lb) < ARCHIVE_AFTER_MS) continue;
    archive.likebatls[id] = lb;
    delete likebatls[id];
    archivedCount++;
  }

  if (archivedCount > 0) {
    saveBattles(); saveContests(); saveLikebatls(); saveArchive();
    console.log(`[GC] ${archivedCount} ta eski yozuv arxivga ko'chirildi.`);
    for (const adminId of ADMIN_IDS) {
      try { await bot.telegram.sendMessage(adminId, `🗑 Avtomatik tozalash: ${archivedCount} ta eski (14+ kun oldin tugagan) battle/konkurs arxivga ko'chirildi.`); } catch (e) {}
    }
  }
}

// ============================================================
//   ESLATMALAR: tugashiga ~1 soat qolgan aktiv battle/konkurs/
//   likebatllar uchun kanalga bitta eslatma yuboriladi (har biriga
//   faqat bir marta — reminderSent belgisi bilan).
// ============================================================
const REMINDER_WINDOW_MS = 60 * 60 * 1000; // 1 soat

async function sendEndingSoonReminders(bot) {
  const now = Date.now();

  for (const battle of Object.values(battles)) {
    if (!battle.active || !battle.endAt || battle.reminderSent) continue;
    if (battle.endAt - now > REMINDER_WINDOW_MS || battle.endAt <= now) continue;
    battle.reminderSent = true;
    saveBattles();
    try {
      await bot.telegram.sendMessage(
        battle.chatId,
        `⏳ <b>Tanlov tez orada yakunlanadi!</b>\n\nDo'stlaringizni chorlang, oxirgi soat qoldi! 🔥`,
        { parse_mode: 'HTML', reply_to_message_id: battle.messageId }
      );
    } catch (e) { console.log('[REMINDER] battle xato:', e.message); }
  }

  for (const contest of Object.values(contests)) {
    if (contest.type !== 'random' || !contest.active || !contest.endAt || contest.reminderSent) continue;
    if (contest.endAt - now > REMINDER_WINDOW_MS || contest.endAt <= now) continue;
    contest.reminderSent = true;
    saveContests();
    try {
      await bot.telegram.sendMessage(
        contest.chatId,
        `⏳ <b>Konkurs tez orada yakunlanadi!</b>\n\nDo'stlaringizni chorlang, g'olib bo'lish imkoniyatini oshiring! 🍀`,
        { parse_mode: 'HTML', reply_to_message_id: contest.messageId }
      );
    } catch (e) { console.log('[REMINDER] contest xato:', e.message); }
  }

  for (const lb of Object.values(likebatls)) {
    if (!lb.active || !lb.setupDone || !lb.endAt || lb.reminderSent) continue;
    if (lb.endAt - now > REMINDER_WINDOW_MS || lb.endAt <= now) continue;
    lb.reminderSent = true;
    saveLikebatls();
    try {
      await bot.telegram.sendMessage(
        lb.chatId,
        `⏳ <b>Like battle tez orada yakunlanadi!</b>\n\nDo'stlaringizni chorlang, ball yig'ishni davom eting! ❤️`,
        { parse_mode: 'HTML', reply_to_message_id: lb.messageId }
      );
    } catch (e) { console.log('[REMINDER] likebatl xato:', e.message); }
  }
}

// ============================================================
//   AVTO-STOP TEKSHIRUVI: vaqt asosida tugashi kerak bo'lgan
//   #boshla battlelar, #random konkurslar va #batl like battlelar.
// ============================================================
async function checkAutoStops(bot) {
  const now = Date.now();

  // ── #boshla: vaqt tugagan bo'lsa to'xtatamiz ──
  for (const battle of Object.values(battles)) {
    if (!battle.active) continue;
    if (battle.endAt && now >= battle.endAt) {
      const sorted = battle.participants
        .map(p => ({ userId: p.userId, count: getVotesForParticipant(battle, p.userId) }))
        .sort((a, b) => b.count - a.count);

      if (sorted.length > 0 && sorted[0].count > 0) {
        await declareWinner(bot, battle, sorted[0].userId);
      } else {
        const prizeLabel = battle.text && battle.text.trim() ? battle.text : 'Hozircha sir🤫';
        await stopBattleNoWinner(bot, battle, `⛔ <b>Battle vaqt tugaganligi sababli yakunlandi.</b>\n\n🎁 Sovrin: ${prizeLabel}\n\nG'olib aniqlanmadi (ovoz yo'q edi).`);
      }
    }
  }

  // ── #random: vaqt tugagan bo'lsa avto-yakunlaymiz ──
  for (const contest of Object.values(contests)) {
    if (contest.type !== 'random' || !contest.active) continue;
    if (contest.endAt && now >= contest.endAt) {
      await finishRandomContest(bot, contest);
    }
  }

  // ── #random: rejalashtirilgan e'lon vaqti yetganlarni publish qilamiz ──
  for (const contest of Object.values(contests)) {
    if (contest.type !== 'random' || !contest.pendingPublish) continue;
    if (contest.publishAt && now >= contest.publishAt) {
      await publishContestNow(bot.telegram, contest);
    }
  }

  // ── #batl: vaqt asosida to'xtatish belgilangan bo'lsa yakunlaymiz ──
  for (const lb of Object.values(likebatls)) {
    if (!lb.active || !lb.setupDone) continue;
    if (lb.endAt && now >= lb.endAt) {
      const { finishLikebatl } = require('./modules/likeBattle');
      await finishLikebatl(bot, lb);
    }
  }
}

// ============================================================
//   KUNLIK AVTOMATIK BACKUP: data/*.json fayllarni har kuni
//   barcha adminlarga hujjat sifatida yuboradi.
// ============================================================
async function sendDailyBackup(bot) {
  if (ADMIN_IDS.length === 0) return;
  flushAllSyncNow();

  const dataDir = path.join(__dirname, '..', 'data');
  const stamp = new Date().toISOString().slice(0, 10);
  const files = ['users.json', 'battles.json', 'contests.json', 'likebatls.json', 'settings.json', 'templates.json']
    .map(name => path.join(dataDir, name))
    .filter(p => fs.existsSync(p));

  if (files.length === 0) return;

  for (const adminId of ADMIN_IDS) {
    for (const filePath of files) {
      try {
        await bot.telegram.sendDocument(adminId, { source: filePath, filename: `${stamp}_${path.basename(filePath)}` });
      } catch (e) { console.log('[CRON] backup yuborishda xato:', adminId, e.message); }
    }
  }
}

// ============================================================
//   HEALTH-CHECK: bot Telegram API bilan aloqasini muntazam
//   tekshiradi, muammo bo'lsa adminlarga xabar beradi.
// ============================================================
async function healthCheck(bot) {
  try {
    await bot.telegram.getMe();
    console.log(`[HEALTH] OK — ${new Date().toISOString()}`);
  } catch (e) {
    console.log('[HEALTH] Bot API bilan bog\'lanishda xato:', e.message);
    for (const adminId of ADMIN_IDS) {
      try { await bot.telegram.sendMessage(adminId, `⚠️ Bot Telegram API bilan bog'lanishda muammo: ${e.message}`); } catch (_) {}
    }
  }
}

function startCronJobs(bot) {
  // Har 5 daqiqada obunani tekshirish
  cron.schedule('*/5 * * * *', () => {
    recheckVoterSubscriptions(bot).catch(e => console.log('[CRON] recheckVoterSubscriptions xato:', e.message));
  });

  // Har 1 daqiqada vaqt asosidagi auto-stoplar va rejalashtirilgan e'lonlarni tekshirish
  cron.schedule('* * * * *', () => {
    checkAutoStops(bot).catch(e => console.log('[CRON] checkAutoStops xato:', e.message));
  });

  // Har 10 daqiqada tugashiga ~1 soat qolgan battle/konkurslarga eslatma
  cron.schedule('*/10 * * * *', () => {
    sendEndingSoonReminders(bot).catch(e => console.log('[CRON] sendEndingSoonReminders xato:', e.message));
  });

  // Har kuni soat 03:00 da eski (14+ kun oldin tugagan) yozuvlarni arxivga ko'chirish
  cron.schedule('0 3 * * *', () => {
    runGarbageCollection(bot).catch(e => console.log('[CRON] runGarbageCollection xato:', e.message));
  });

  // Har kuni soat 04:00 da (GMT+5) barcha adminlarga avtomatik backup
  cron.schedule('0 4 * * *', () => {
    sendDailyBackup(bot).catch(e => console.log('[CRON] sendDailyBackup xato:', e.message));
  });

  // Har soatda bot-Telegram API aloqasini tekshirish
  cron.schedule('0 * * * *', () => {
    healthCheck(bot).catch(e => console.log('[CRON] healthCheck xato:', e.message));
  });

  console.log('⏰ Cron vazifalar ishga tushdi: obuna/auto-stop tekshiruvi, eslatmalar, kunlik backup/GC, soatlik health-check.');
}

module.exports = {
  startCronJobs, recheckVoterSubscriptions, checkAutoStops,
  sendDailyBackup, healthCheck, runGarbageCollection, sendEndingSoonReminders
};
