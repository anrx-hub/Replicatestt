/**
 * بوت واتساب للعبة "ربليكا" (Replica) الجماعية
 * الاسم الافتراضي للملف تم تعديله إلى index.js ليتوافق مع KataBump
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// هنا تم إضافة إعدادات الـ Puppeteer لضمان عدم حدوث Crash على السيرفر المستضيف
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', 
            '--disable-gpu'
        ],
    }
});

const games = {};
const ARABIC_LETTERS = ['أ', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'هـ', 'و', 'ي'];
const CATEGORIES = ['اسم', 'حيوان', 'نبات', 'جماد', 'دولة'];

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('=== امسح كود الـ QR أعلاه لتشغيل البوت ===');
});

client.on('ready', () => {
    console.log('🤖 بوت لعبة ربليكا جاهز للعمل في المجموعات!');
});

client.on('message', async (msg) => {
    const chatId = msg.from;
    const body = msg.body.trim();
    const senderId = msg.author || msg.from;

    const contact = await msg.getContact();
    const playerName = contact.pushname || 'لاعب';

    if (body === '!ربليكا' || body === '!انشاء') {
        if (games[chatId]) {
            return msg.reply('❌ هناك لعبة قائمة بالفعل في هذه المجموعة أو التسجيل مفتوح!');
        }

        games[chatId] = {
            status: 'registration',
            players: [],
            currentLetter: '',
            currentCategoryIndex: 0,
            currentPlayerTurn: null,
            timer: null,
            round: 1
        };

        return msg.reply(
            `🎮 *لعبة ريبلِكا الجماعية* 🎮\n\n` +
            `*طريقة اللعب:*\n` +
            `1️⃣ اضغط أو اكتب الأمرين أدناه لدخول اللعبة.\n` +
            `2️⃣ يتم اختيار حرف عشوائي كل جولة.\n` +
            `3️⃣ لكل نوع (اسم، حيوان، نبات، جماد، دولة) سيختار البوت لاعباً عشوائياً ليرسل الكلمة المناسبة للحرف.\n` +
            `4️⃣ اللاعب الذي يتأخر أو يخطئ يتم استبعاده، وآخر لاعب يتبقى هو الفائز!\n\n` +
            `📝 لدخول اللعبة الآن، أرسل: *!دخول*\n` +
            `🚀 لبدء اللعبة بعد تجمع اللاعبين، أرسل: *!ابدأ*`
        );
    }

    if (body === '!دخول') {
        const game = games[chatId];
        if (!game) return;
        if (game.status !== 'registration') return msg.reply('❌ لا يمكنك الدخول، اللعبة بدأت بالفعل أو لم يتم إنشاؤها بعد!');

        const isRegistered = game.players.some(p => p.id === senderId);
        if (isRegistered) {
            return msg.reply(`⚠️ يا @${contact.id.user}، أنت مسجل بالفعل في اللعبة!`, null, { mentions: [contact] });
        }

        game.players.push({ id: senderId, name: playerName, contactObj: contact });
        return msg.reply(`✅ تم تسجيلك بنجاح يا @${contact.id.user}! [عدد اللاعبين الحالي: ${game.players.length}]`, null, { mentions: [contact] });
    }

    if (body === '!ابدأ') {
        const game = games[chatId];
        if (!game) return;
        if (game.status !== 'registration') return;

        if (game.players.length < 2) {
            return msg.reply('❌ لا يمكن بدء اللعبة بأقل من لاعبين (2)! من فضلك انتظر دخول بقية الأصدقاء.');
        }

        game.status = 'playing';
        await msg.reply('🔥 استعدوا.. انطلقت لعبة ريبلِكا! جاري اختيار الحرف الأول...');
        
        startNextRound(chatId);
        return;
    }

    const game = games[chatId];
    if (game && game.status === 'playing' && game.currentPlayerTurn) {
        if (senderId === game.currentPlayerTurn.id) {
            const currentCategory = CATEGORIES[game.currentCategoryIndex];
            const requiredLetter = game.currentLetter;

            if (body.startsWith(requiredLetter)) {
                clearTimeout(game.timer);

                await msg.reply(`✅ إجابة صحيحة ومقبولة من @${senderId.split('@')[0]}! (${currentCategory} -> ${body})`, null, {
                    mentions: [game.currentPlayerTurn.contactObj]
                });

                game.currentCategoryIndex++;

                if (game.currentCategoryIndex >= CATEGORIES.length) {
                    game.currentCategoryIndex = 0;
                    game.round++;
                    await client.sendMessage(chatId, `✨ أحسنتم! انتهت فئات هذا الحرف بنجاح. لننتقل للجولة رقم ${game.round} بحرف جديد!`);
                    
                    if (game.players.length <= 1) {
                        endGame(chatId);
                        return;
                    }
                    
                    setTimeout(() => startNextRound(chatId), 2000);
                } else {
                    setTimeout(() => askNextCategory(chatId), 2000);
                }
            } else {
                msg.reply(`❌ خطأ! الكلمة يجب أن تبدأ بحرف *[ ${requiredLetter} ]*. حاول مجدداً بسرعة قبل انتهاء الوقت!`);
            }
        }
    }
});

async function startNextRound(chatId) {
    const game = games[chatId];
    if (!game) return;

    const randomIndex = Math.floor(Math.random() * ARABIC_LETTERS.length);
    game.currentLetter = ARABIC_LETTERS[randomIndex];
    game.currentCategoryIndex = 0;

    await client.sendMessage(chatId, `🔠 الحرف المختار لهذه الجولة هو: 🔥 *[ ${game.currentLetter} ]* 🔥\nاستعدوا لتوزيع الفئات العشوائية!`);

    setTimeout(() => askNextCategory(chatId), 2500);
}

async function askNextCategory(chatId) {
    const game = games[chatId];
    if (!game) return;

    if (game.players.length <= 1) {
        endGame(chatId);
        return;
    }

    const currentCategory = CATEGORIES[game.currentCategoryIndex];
    const randomPlayerIndex = Math.floor(Math.random() * game.players.length);
    game.currentPlayerTurn = game.players[randomPlayerIndex];

    await client.sendMessage(chatId, 
        `🎯 الفئة المطلوبة الآن: *[ ${currentCategory} ]*\n` +
        `🔤 الحرف: *[ ${game.currentLetter} ]*\n\n` +
        `👤 دور اللاعب: @${game.currentPlayerTurn.id.split('@')[0]}\n` +
        `⏳ أمامك *20 ثانية* فقط لإرسال الإجابة الصحيحة!`, 
        { mentions: [game.currentPlayerTurn.contactObj] }
    );

    game.timer = setTimeout(() => {
        eliminatePlayer(chatId);
    }, 20000);
}

async function eliminatePlayer(chatId) {
    const game = games[chatId];
    if (!game) return;

    const eliminatedPlayer = game.currentPlayerTurn;
    game.players = game.players.filter(p => p.id !== eliminatedPlayer.id);

    await client.sendMessage(chatId, 
        `💥 انتهى الوقت! تم استبعاد اللاعب @${eliminatedPlayer.id.split('@')[0]} من اللعبة لعدم الإجابة في الوقت المحدد!`,
        { mentions: [eliminatedPlayer.contactObj] }
    );

    if (game.players.length <= 1) {
        endGame(chatId);
    } else {
        game.currentCategoryIndex++;
        if (game.currentCategoryIndex >= CATEGORIES.length) {
            game.currentCategoryIndex = 0;
            game.round++;
            await client.sendMessage(chatId, `⚙️ ننتقل للجولة رقم ${game.round} بحرف جديد بعد استبعاد أحد اللاعبين!`);
            setTimeout(() => startNextRound(chatId), 2000);
        } else {
            setTimeout(() => askNextCategory(chatId), 2000);
        }
    }
}

async function endGame(chatId) {
    const game = games[chatId];
    if (!game) return;

    if (game.players.length === 1) {
        const winner = game.players[0];
        await client.sendMessage(chatId, 
            `👑🎉 *مبــــــــرّوك الفــــــــوز!* 🎉👑\n\n` +
            `اللاعب الأخير الصامد في لعبة ريبلِكا هو: @${winner.id.split('@')[0]}\n` +
            `لقد تفوقت على الجميع بجدارتك وسرعتك! 🏆`,
            { mentions: [winner.contactObj] }
        );
    } else {
        await client.sendMessage(chatId, `🏁 انتهت اللعبة ولم يتبقَ أي لاعبين للفوز!`);
    }

    delete games[chatId];
}

client.initialize();
