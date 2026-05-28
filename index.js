/**
 * بوت لعبة "ربليكا" (Replica) الجماعية لواتساب
 * تم استخدام مكتبة Baileys لتفادي أخطاء متصفح Puppeteer والـ Crashes على سيرفرات الاستضافة
 */

const { 
    makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason 
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

const ARABIC_LETTERS = ['أ', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'هـ', 'و', 'ي'];
const CATEGORIES = ['اسم', 'حيوان', 'نبات', 'جماد', 'دولة'];
const games = {};

async function startBot() {
    // إعداد حفظ جلسة تسجيل الدخول تلقائياً في مجلد auth_info
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // سنطبعه باستخدام qrcode-terminal بشكل منظم
        logger: pino({ level: 'silent' }),
        browser: ['Replica Bot', 'Chrome', '1.0.0']
    });

    // حفظ التحديثات على الجلسة أولاً بأول
    sock.ev.on('creds.update', saveCreds);

    // إدارة الاتصال وكود الـ QR
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrcode.generate(qr, { small: true });
            console.log('=== امسح كود الـ QR أعلاه لتشغيل البوت على هاتف آخر ===');
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('❌ تم إغلاق الاتصال بسبب: ', lastDisconnect?.error, '. جاري إعادة الاتصال: ', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('🤖 تم الاتصال بنجاح! بوت لعبة ربليكا جاهز للعمل في المجموعات.');
        }
    });

    // استقبال الرسائل وإدارة اللعبة
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        const senderId = msg.key.participant || msg.key.remoteJid;
        
        // استخراج النص من الرسالة بمرونة
        const body = (msg.message.conversation || 
                      msg.message.extendedTextMessage?.text || 
                      '').trim();

        const playerName = msg.pushName || 'لاعب';

        // دالة مساعدة لإرسال الرسائل بسهولة مع منشن
        const sendMessage = async (text, mentions = []) => {
            await sock.sendMessage(chatId, { text, mentions }, { quoted: msg });
        };

        // 1. أمر إنشاء اللعبة
        if (body === '!ربليكا' || body === '!انشاء') {
            if (games[chatId]) {
                return sendMessage('❌ هناك لعبة قائمة بالفعل في هذه المجموعة أو التسجيل مفتوح!');
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

            return sendMessage(
                `🎮 *لعبة ريبلِكا الجماعية* 🎮\n\n` +
                `*طريقة اللعب:*\n` +
                `1️⃣ اكتب الأمرين أدناه لدخول اللعبة والبدء.\n` +
                `2️⃣ يتم اختيار حرف عشوائي كل جولة.\n` +
                `3️⃣ لكل نوع (اسم، حيوان، نبات، جماد، دولة) سيختار البوت لاعباً عشوائياً ليرسل الكلمة المناسبة للحرف.\n` +
                `4️⃣ اللاعب الذي يتأخر (20 ثانية) أو يخطئ يتم استبعاده، وآخر لاعب يتبقى هو الفائز!\n\n` +
                `📝 لدخول اللعبة الآن، أرسل: *!دخول*\n` +
                `🚀 لبدء اللعبة بعد تجمع اللاعبين، أرسل: *!ابدأ*`
            );
        }

        // 2. أمر دخول اللاعبين
        if (body === '!دخول') {
            const game = games[chatId];
            if (!game) return;
            if (game.status !== 'registration') return sendMessage('❌ لا يمكنك الدخول، اللعبة بدأت بالفعل!');

            const isRegistered = game.players.some(p => p.id === senderId);
            if (isRegistered) {
                return sendMessage(`⚠️ أنت مسجل بالفعل في اللعبة يا @${senderId.split('@')[0]}!`, [senderId]);
            }

            game.players.push({ id: senderId, name: playerName });
            return sendMessage(`✅ تم تسجيلك بنجاح يا @${senderId.split('@')[0]}! [العدد الحالي: ${game.players.length}]`, [senderId]);
        }

        // 3. أمر بدء اللعبة الفعلي
        if (body === '!ابدأ') {
            const game = games[chatId];
            if (!game) return;
            if (game.status !== 'registration') return;

            if (game.players.length < 2) {
                return sendMessage('❌ لا يمكن بدء اللعبة بأقل من لاعبين (2)! من فضلك انتظر دخول بقية الأصدقاء.');
            }

            game.status = 'playing';
            await sendMessage('🔥 استعدوا.. انطلقت لعبة ريبلِكا! جاري اختيار الحرف الأول...');
            
            startNextRound(sock, chatId);
            return;
        }

        // 4. فحص إجابات اللاعب المستهدف أثناء اللعب
        const game = games[chatId];
        if (game && game.status === 'playing' && game.currentPlayerTurn) {
            if (senderId === game.currentPlayerTurn.id) {
                const currentCategory = CATEGORIES[game.currentCategoryIndex];
                const requiredLetter = game.currentLetter;

                // التحقق من الحرف الأول مع تجاهل ال التعريف إن وجدت لتسهيل اللعب
                let cleanBody = body;
                if (body.startsWith('ال') && body.length > 2) {
                    cleanBody = body.substring(2);
                }

                if (cleanBody.startsWith(requiredLetter)) {
                    clearTimeout(game.timer);

                    await sendMessage(`✅ إجابة صحيحة ومقبولة من @${senderId.split('@')[0]}! (${currentCategory} -> ${body})`, [senderId]);

                    game.currentCategoryIndex++;

                    if (game.currentCategoryIndex >= CATEGORIES.length) {
                        game.currentCategoryIndex = 0;
                        game.round++;
                        await sock.sendMessage(chatId, { text: `✨ أحسنتم! انتهت فئات هذا الحرف بنجاح. لننتقل للجولة رقم ${game.round} بحرف جديد!` });
                        
                        if (game.players.length <= 1) {
                            endGame(sock, chatId);
                            return;
                        }
                        
                        setTimeout(() => startNextRound(sock, chatId), 2000);
                    } else {
                        setTimeout(() => askNextCategory(sock, chatId), 2000);
                    }
                } else {
                    await sendMessage(`❌ خطأ! الكلمة يجب أن تبدأ بحرف *[ ${requiredLetter} ]*. حاول مجدداً بسرعة!`);
                }
            }
        }
    });
}

function startNextRound(sock, chatId) {
    const game = games[chatId];
    if (!game) return;

    const randomIndex = Math.floor(Math.random() * ARABIC_LETTERS.length);
    game.currentLetter = ARABIC_LETTERS[randomIndex];
    game.currentCategoryIndex = 0;

    sock.sendMessage(chatId, { text: `🔠 الحرف المختار لهذه الجولة هو: 🔥 *[ ${game.currentLetter} ]* 🔥\nاستعدوا لتوزيع الفئات العشوائية!` });

    setTimeout(() => askNextCategory(sock, chatId), 2500);
}

function askNextCategory(sock, chatId) {
    const game = games[chatId];
    if (!game) return;

    if (game.players.length <= 1) {
        endGame(sock, chatId);
        return;
    }

    const currentCategory = CATEGORIES[game.currentCategoryIndex];
    const randomPlayerIndex = Math.floor(Math.random() * game.players.length);
    game.currentPlayerTurn = game.players[randomPlayerIndex];

    const mentionText = `🎯 الفئة المطلوبة الآن: *[ ${currentCategory} ]*\n` +
                        `🔤 الحرف: *[ ${game.currentLetter} ]*\n\n` +
                        `👤 دور اللاعب: @${game.currentPlayerTurn.id.split('@')[0]}\n` +
                        `⏳ أمامك *20 ثانية* فقط لإرسال الإجابة الصحيحة!`;

    sock.sendMessage(chatId, { text: mentionText, mentions: [game.currentPlayerTurn.id] });

    game.timer = setTimeout(() => {
        eliminatePlayer(sock, chatId);
    }, 20000);
}

function eliminatePlayer(sock, chatId) {
    const game = games[chatId];
    if (!game) return;

    const eliminatedPlayer = game.currentPlayerTurn;
    game.players = game.players.filter(p => p.id !== eliminatedPlayer.id);

    sock.sendMessage(chatId, { 
        text: `💥 انتهى الوقت! تم استبعاد اللاعب @${eliminatedPlayer.id.split('@')[0]} من اللعبة لعدم الإجابة في الوقت المحدد!`, 
        mentions: [eliminatedPlayer.id] 
    });

    if (game.players.length <= 1) {
        endGame(sock, chatId);
    } else {
        game.currentCategoryIndex++;
        if (game.currentCategoryIndex >= CATEGORIES.length) {
            game.currentCategoryIndex = 0;
            game.round++;
            sock.sendMessage(chatId, { text: `⚙️ ننتقل للجولة رقم ${game.round} بحرف جديد بعد استبعاد أحد اللاعبين!` });
            setTimeout(() => startNextRound(sock, chatId), 2000);
        } else {
            setTimeout(() => askNextCategory(sock, chatId), 2000);
        }
    }
}

function endGame(sock, chatId) {
    const game = games[chatId];
    if (!game) return;

    if (game.players.length === 1) {
        const winner = game.players[0];
        sock.sendMessage(chatId, { 
            text: `👑🎉 *مبــــــــرّوك الفــــــــوز!* 🎉👑\n\nاللاعب الأخير الصامد في لعبة ريبلِكا هو: @${winner.id.split('@')[0]}\nلقد تفوقت على الجميع بجدارتك وسرعتك! 🏆`, 
            mentions: [winner.id] 
        });
    } else {
        sock.sendMessage(chatId, { text: `🏁 انتهت اللعبة ولم يتبقَ أي لاعبين للفوز!` });
    }

    delete games[chatId];
}

// تشغيل البوت
startBot();
