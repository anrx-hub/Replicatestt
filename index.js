/**
 * بوت لعبة "ربليكا" (Replica) الجماعية لواتساب
 * نسخة معدلة لمنصة Render (تم تحويل رسائل السيرفر للإنجليزية لعدم قلب الحروف العربية)
 */

const { 
    makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason 
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

const ARABIC_LETTERS = ['أ', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'هـ', 'و', 'ي'];
const CATEGORIES = ['اسم', 'حيوان', 'نبات', 'جماد', 'دولة'];
const games = {};

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, 
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '20.0.04'] 
    });

    // === رقم الهاتف الخاص بك ===
    const phoneNumber = "212674636956"; 

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                console.log(`\n[!] Requesting Pairing Code for: ${phoneNumber} ...`);
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join('-') || code;
                
                // هنا تم تعديل الكتابة لتظهر بالإنجليزية والفرانكو بوضوح في Render دون انقلاب الحروف
                console.log(`\n==================================================`);
                console.log(`👑 YOUR PAIRING CODE IS: 🔥 【 ${code} 】 🔥`);
                console.log(`==================================================\n`);
                console.log(`👉 Open WhatsApp -> Linked Devices -> Link with phone number -> Enter the code above.`);
            } catch (error) {
                console.error('❌ Error requesting pairing code:', error);
            }
        }, 3000); 
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('[!] Connection closed. Reconnecting: ', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('\n[+] SUCCESS: Bot is now connected and running perfectly!');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        const senderId = msg.key.participant || msg.key.remoteJid;
        
        const body = (msg.message.conversation || 
                      msg.message.extendedTextMessage?.text || 
                      '').trim();

        const playerName = msg.pushName || 'لاعب';

        const sendMessage = async (text, mentions = []) => {
            await sock.sendMessage(chatId, { text, mentions }, { quoted: msg });
        };

        // 1. أمر إنشاء اللعبة (عربي بالكامل داخل الواتساب)
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

        // 4. فحص الإجابات
        const game = games[chatId];
        if (game && game.status === 'playing' && game.currentPlayerTurn) {
            if (senderId === game.currentPlayerTurn.id) {
                const currentCategory = CATEGORIES[game.currentCategoryIndex];
                const requiredLetter = game.currentLetter;

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

startBot();
