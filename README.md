# OvozBattleBot 2.1

Telegram kanal uchun ovoz-battle, random konkurs va like-battle boti.
Ko'p faylga bo'lingan struktura, `fs-extra` asosidagi JSON saqlash, va `node-cron` orqali avtomatik tekshiruvlar.

## Yangi (v2.1)

- **Stars tuzatildi**: like battledagi "⭐ Stars yuborish" endi haqiqiy Telegram Stars invoice ochadi (avval bu tugma umuman ishlamas edi).
- **Tugma ranglari**: barcha tugmalar (reply va inline) `style: primary/success/danger` bilan chiqadi (Bot API 9.4+). `/admin` → 🎨 orqali istalgan vaqt o'zgartirish mumkin (yoki `/renglar`).
- **Custom premium emoji**: `/admin` → 😀 Custom Emoji sozlamalari — har bir tugma uchun alohida premium emoji tayinlash (forward qilib yoki ID raqami bilan). Faqat bot egasi Telegram Premium bo'lsa yoki bot Fragment orqali username sotib olgan bo'lsa ko'rinadi (Telegram cheklovi).
- **Ovoz/qatnashuv ID-asosli**: username o'zgarsa ham battle ma'lumotlari yo'qolmaydi (avval username orqali saqlanardi).
- **Disk yozish optimallashtirildi**: sinxron blok o'rniga debounce qilingan asinxron saqlash.

## O'rnatish

```bash
npm install
cp .env.example .env
# .env faylini to'ldiring: BOT_TOKEN, BOT_USERNAME, ADMIN_IDS
npm start
```

`ADMIN_IDS` bir nechta bo'lishi mumkin, vergul bilan: `ADMIN_IDS=1133456,2737283`

## Loyiha tuzilishi

```
src/
  config.js              .env, ADMIN_IDS, isAdmin()
  db.js                  fs-extra asosida JSON saqlash (users/battles/contests/likebatls/settings)
  buttons.js             markazlashgan tugma yordamchisi (style + custom emoji + registr)
  helpers.js             umumiy yordamchi funksiyalar (ID, obuna tekshiruvi, captcha, GMT+5 vaqt)
  state.js               matn kiritish uchun holat mashinasi
  keyboards.js           umumiy klaviaturalar (asosiy menyu, admin panel)
  cron.js                har 5 daqiqada obuna tekshiruvi + har 1 daqiqada auto-stop/publish tekshiruvi
  index.js               botni ishga tushiruvchi asosiy fayl
  modules/
    voteBattle.js        #boshla — ovoz battle
    randomContest.js     #random — random konkurs (+ botda yaratish wizard)
    likeBattle.js        #batl — like battle (+ botda yaratish wizard)
    admin.js             /admin panel
data/
  *.json                 saqlangan ma'lumotlar (ishga tushganda avto-yaratiladi)
```

## Tugma ranglari haqida muhim eslatma

**Telegram Bot API inline tugmalarga haqiqiy rang (yashil/ko'k/qizil fon) berishni umuman qo'llab-quvvatlamaydi.** Bu Telegram platformasining o'zining cheklovi — hech qaysi bot buni o'zgartira olmaydi. Screenshotdagi yashil/qizil tugmalar Telegram mobil ilovasining ayrim eski/maxsus interfeyslarida ko'rinadigan uslub, lekin bot tomonidan boshqarilmaydi.

Shu sabab botda eng yaqin va barqaror yechim qo'llanildi: muhim tugmalarga **rangni bildiruvchi emoji** qo'yildi —
- 🟢 — ijobiy/davom ettiruvchi amal (Qatnashish, Boshlash, Hoziroq)
- 🔵 — neytral/sozlash amali (Sozlash, Belgilangan vaqtda)
- 🔴 — to'xtatuvchi/yakunlovchi amal (Stop, Yakunlash)

## Kanalda ishlatish (botni kanalga **admin** qilib qo'shing)

### `#boshla` — Ovoz battle
```
#boshla
🎁 Sovrin: 100 Stars
#soni 50
#vaqt 26.06.28 20:00
```
- `#soni 50` — ixtiyoriy, 50-ovozga yetgan ishtirokchi avtomatik g'olib bo'ladi.
- `#vaqt 26.06.28 20:00` — ixtiyoriy, GMT+5 bo'yicha shu vaqtda battle avto to'xtaydi (eng ko'p ovoz olgan g'olib bo'ladi).
- Har ishtirokchi va "Qatnashish"/"Natijalar" tugmalari **url tugma** — bosilganda odam botga o'tadi, hamma amal (qatnashish, ovoz berish) shaxsiy chatda bo'ladi.
- Har bir odam shu battleda faqat **1 marta** ovoz bera oladi.

### `#random` — Random konkurs
```
#random
Yangi konkurs boshlandi!
Shartlar: kanalga obuna bo'lish
#soni 10
#win 2
#vaqt 26.06.28 20:00
```
- `#soni 10` — qatnashchilar maqsadi: shu songa yetilganda konkurs avto yakunlanadi.
- `#win 2` — nechta g'olib tasodifiy tanlanadi (default: 1).
- `#vaqt ...` — GMT+5 bo'yicha tugash vaqti; yetganda konkurs avto yakunlanadi.
- Qo'lda to'xtatish: `/stoprandom` buyrug'i (kanal admini yoki yaratuvchi) yoki "🎲 Mening konkurslarim" menyusi.

**Botda yaratish:** "➕ Konkurs yaratish" tugmasi orqali to'liq wizard: matn → g'oliblar soni → qachon e'lon qilinsin (hoziroq / belgilangan vaqtda) → qanday tugatilsin (odam soniga qarab / vaqtga qarab) → kanal.

### `#batl` — Like battle (reaksiya/stars/comment)
```
#batl
```
- Avval kanalda faqat "🔵 Sozlash (faqat admin)" tugmasi chiqadi (url → bot).
- Botda kanal admini ball miqdorlarini (reaksiya/stars/comment) sozlaydi, so'ng "🟢 Boshlash"ni bosadi.
- Shundan keyin kanalda jonli "🟢 Battlega qo'shilish" posti chiqadi (url → bot).
- Qatnashgan har bir odam uchun alohida post yuboriladi — postning pastida **❤️ Reaksiya** va **💬 Comment** tugmalari turadi (kanal ichida, callback tugma sifatida — bular ishlайdi, chunki Telegram bunga ruxsat beradi).

**Reaksiya tugmasi (❤️):**
- Bosilganda avval bot foydalanuvchining **shu battle o'tayotgan kanalga obuna ekanligini** tekshiradi.
- Obuna bo'lmasa — "❌ Reaksiya berish uchun avval kanalga obuna bo'ling!" deb rad etiladi, ball qo'shilmaydi.
- Obuna bo'lsa — ball darrov qo'shiladi va post yangilanadi. 1 user = 1 marta.

**Comment tugmasi (💬):**
- Bosilganda ham xuddi shunday obuna tekshiriladi.
- Obuna bo'lsa, foydalanuvchi **botga o'tadi** va undan matn so'raladi: "💬 [Ism] uchun commentingizni yozib qoldiring".
- Foydalanuvchi botga matn yozganda, bu matn ishtirokchi posti ostiga **reply sifatida kanalga** yuboriladi (`👤 [Ism] uchun:\n[yozuvchi]: [matn]`) va ball qo'shiladi. 1 user = 1 marta.

**Botda yaratish:** "➕ Like battle yaratish" tugmasi orqali to'liq wizard: matn → ball sozlamalari (tugma orqali reaksiya/stars/comment ballarini alohida edit qilish) → qachon stop (vaqtga qarab / o'zim stop qilaman) → kanal.

Boshqarish: "🥊 Mening like battlelarim" menyusi yoki `/lb` buyrug'i.

## Botda yaratish (shaxsiy ovoz-battle)

Asosiy menyudan **🏆 Battle yaratish**ni bosing:
1. Sovrin matnini kiriting.
2. Maqsad ovoz sonini kiriting (0 — faqat vaqt bilan tugatish uchun).
3. Agar 0 kiritilsa — tugash vaqtini so'raydi (`KK.OO.YY SS:DD`, GMT+5).
4. Kanal username'ini kiriting.

## Boshqaruv menyulari ("Mening ...larim")

**Muhim tuzatish:** Avvalgi versiyada bu menyular faqat **botda shaxsan yaratilgan** o'yinlarni ko'rsatardi. Kanalda `#boshla`, `#random`, yoki `#batl` orqali avto-yaratilgan o'yinlar (egasi botda emas, balki kanal o'zi) ko'rinmasdi va "sizda hech narsa yo'q" deyilardi. Endi har bir menyu o'zi yaratganlar **VA** hozir admin bo'lgan kanallarda boshlangan barcha o'yinlarni tekshirib chiqadi va ko'rsatadi.

- **📋 Mening ovoz battlelarim** — har battle uchun: ishtirokchilar ro'yxati, kim kimga ovoz bergani, natijalar, maqsadni o'zgartirish, to'xtatish.
- **🎲 Mening konkurslarim** — random konkurslarni boshqarish, qatnashchilar ro'yxati, yakunlash.
- **🥊 Mening like battlelarim** — admin bo'lgan kanallardagi like battlelarni ko'rish/boshqarish/sozlash/to'xtatish.

## Avtomatik tekshiruvlar (cron)

- **Har 5 daqiqada**: ovoz bergan har bir foydalanuvchining hali ham kanal a'zosi ekanligi tekshiriladi. Agar kanaldan chiqib ketgan bo'lsa, ovozi bekor qilinadi (**-1**) va battle posti yangilanadi.
- **Har 1 daqiqada**: vaqt asosida tugashi belgilangan `#boshla`, `#random`, `#batl` lar tekshiriladi; vaqti yetganlar avtomatik yakunlanadi. Shuningdek, "belgilangan vaqtda e'lon qilinsin" deb yaratilgan random konkurslar shu vaqt kelganda avtomatik kanalga chiqariladi.

## Captcha (ixtiyoriy)

`/admin` panelidan "Captcha (qatnashish)" va "Captcha (ovoz berish)" yoqilishi/o'chirilishi mumkin.

## Eslatma

Like battle'dagi reaksiya/comment endi **real Telegram reaction emas**, balki bot tomonidan boshqariladigan ❤️/💬 inline tugmalar orqali ishlaydi. Bu yondashuv tanlandi, chunki Telegram kanal postlaridagi haqiqiy reaksiyalarni bot API orqali ishonchli kuzatish imkonsiz (ko'pchilik kanallarda bu ma'lumot botlarga umuman yuborilmaydi). Tugma-asosli tizim 100% ishonchli ishlaydi va obuna tekshiruvini ham to'g'ri qo'llay oladi.
