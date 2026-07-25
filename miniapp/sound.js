// ============================================================
//   SOUND ENGINE — tashqi audio fayllarsiz, Web Audio API orqali
//   real vaqtda sintez qilingan qisqa tovushlar. Har bir turdagi
//   tugma bosilganda o'ziga xos tovush chiqadi (tap, success,
//   error, whoosh, pop).
// ============================================================
const SoundEngine = (() => {
  let ctx = null;
  let unlocked = false;

  function getCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    return ctx;
  }

  // iOS/Safari/Telegram WebView'da AudioContext faqat foydalanuvchi
  // gesture'idan keyin ishga tushadi, va resume() asinxron (Promise)
  // bo'lgani uchun ba'zan birinchi tovush ulgurmay qolishi mumkin.
  // Shu sabab: (1) har bir tovush chaqiruvidan OLDIN ham unlock
  // chaqiramiz (ehtiyot uchun), (2) resume() dan keyin sukut (silent)
  // bitta qisqa buffer chalib kontekstni to'liq "isitib" qo'yamiz —
  // bu WebKit'da tanilgan ishonchli usul.
  function unlock() {
    const c = getCtx();
    if (!c) return;
    if (c.state === 'suspended') {
      c.resume().catch(() => {});
    }
    if (unlocked) return;
    unlocked = true;
    try {
      const buffer = c.createBuffer(1, 1, 22050);
      const src = c.createBufferSource();
      src.buffer = buffer;
      src.connect(c.destination);
      src.start(0);
    } catch (e) {}
  }

  function tone(freq, duration, type, gainPeak, delay = 0) {
    unlock();
    const c = getCtx();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(gainPeak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  return {
    unlock,

    // Oddiy tugma bosish — qisqa, yumshoq "tik"
    tap() { tone(720, 0.07, 'sine', 0.085); },

    // Asosiy/primary tugma — biroz to'liqroq "tuk"
    primary() { tone(480, 0.09, 'triangle', 0.1); },

    // Muvaffaqiyat — ko'tarilib boruvchi ikki nota
    success() {
      tone(660, 0.1, 'sine', 0.115);
      tone(990, 0.14, 'sine', 0.1, 0.08);
    },

    // Xato — past, qisqa "buzz"
    error() { tone(180, 0.16, 'sawtooth', 0.075); },

    // Karta/sahifa almashishi — yengil "whoosh" (chastota siljishi)
    whoosh() {
      unlock();
      const c = getCtx();
      if (!c) return;
      const t0 = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(300, t0);
      osc.frequency.exponentialRampToValueAtTime(900, t0 + 0.18);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.058, t0 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      osc.connect(gain).connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + 0.22);
    },

    // Modal/sheet ochilishi — yumshoq "pop"
    pop() { tone(520, 0.06, 'sine', 0.075); }
  };
})();
