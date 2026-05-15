const TELEGRAM_API = `https://telegram.org{process.env.BOT_TOKEN}`;
const DEEPSEEK_API = "https://deepseek.com";
const SUPABASE_URL = process.env.SUPABASE_URL; // Expected output format: https://supabase.co
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY; 
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;

// 1. TIMESTAMPS & LOCAL TIMEZONE MATRIX (Section 1.1)
function getFormattedLocalTime(unixTimestamp) {
    const dateObj = new Date(unixTimestamp * 1000);
    return {
        date: dateObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
        time: dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };
}

// 2. DYNAMIC DATABASE FETCH ENGINE FOR RULES OVERRIDES (Cleaned URLs)
async function fetchDatabaseRules() {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/alex_config?select=key,value`, {
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
        });
        const rows = await res.json();
        const configMap = {};
        if (Array.isArray(rows)) {
            rows.forEach(r => { configMap[r.key] = r.value; });
        }
        return configMap;
    } catch (e) {
        console.log("Config fetch error:", e.message);
        return {};
    }
}

async function updateDatabaseRules(key, newValue) {
    try {
        await fetch(`${SUPABASE_URL}/rest/v1/alex_config?key=eq.${key}`, {
            method: "PATCH",
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ value: newValue })
        });
    } catch (e) {
        console.log("Config update failed:", e.message);
    }
}

// 3. STORAGE LOG MATRIX (Section 1.2 & 3.2)
async function getChatHistory(chatId) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/alex_memory?chat_id=eq.${chatId}&order=created_at.asc&limit=20`, {
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
        });
        const rows = await res.json();
        return Array.isArray(rows) ? rows.map(r => ({ role: r.role, content: r.content })) : [];
    } catch (e) {
        return [];
    }
}

async function saveChatToMemory(chatId, role, content) {
    try {
        await fetch(`${SUPABASE_URL}/rest/v1/alex_memory`, {
            method: "POST",
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: String(chatId), role: role, content: content })
        });
    } catch (e) {
        console.log("Memory save failed:", e.message);
    }
}

async function savePermanentMemoryBlock(type, content) {
    try {
        await fetch(`${SUPABASE_URL}/rest/v1/alex_memory`, { // Aligned to table 'alex_memory'
            method: "POST",
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: "1123787650", role: type, content: content })
        });
    } catch (e) {
        console.log("Permanent block failed:", e.message);
    }
}

// 4. BINANCE LIVE API CORE SCANNERS (Fixed URL String Templates)
async function fetchBinanceLiveTicker(symbol) {
    try {
        const res = await fetch(`https://binance.com{symbol}USDT`);
        const data = await res.json();
        return data.price ? parseFloat(data.price).toFixed(2) : "Live Tracking Offline";
    } catch (e) {
        return "Network Delay";
    }
}

// 5. DEEPSEEK ADVANCED LOGIC ARCHITECTURE WITH LANGUAGE MIRROR FILTER
async function queryAlexBrain(chatId, userText, userName, isCreator, localTimeFrame, priceData, history, dbRules) {
    const systemPromptText = dbRules.system_prompt || "You are Alex, a loyal smart companion. Speak in Hinglish.";
    const watchlist = dbRules.watchlist_coins || "BTC,ETH,SOL";
    const rrRatio = dbRules.min_risk_reward || "1:3";
    const winProb = dbRules.min_win_probability || "70%";

    const systemPrompt = `
    ${systemPromptText}

    REAL-TIME CONSCIOUSNESS CONTEXT (CRITICAL):
    - Current Real-Time Date: ${localTimeFrame.date}
    - Current Local User Time: ${localTimeFrame.time}
    - Live Cryptocurrency Rates: Bitcoin: $${priceData.BTC} | Ethereum: $${priceData.ETH} | Solana: $${priceData.SOL}
    
    IDENTITY SENSORS (WHO IS WHO?):
    - Your Name is ALWAYS: Alex. You are the AI Agent.
    - Talking to User Name: ${userName} (Chat ID: ${chatId}).
    - IDENTITY CHECK: ${isCreator ? "This user is NADEEM BHAI. He is your CREATOR and BOSS. Address him hamesha as 'Sir' or 'Boss' with high respect." : `This user is a GUEST named ${userName}. Do NOT call them Alex. Address them initially as Sir/Ma'am. If they ask to be called by their name or specific greeting, adapt instantly to make them feel normal.`}

    BEHAVIOR & LANGUAGE MIRRORING RULES (Section 1.1):
    - DYNAMIC LANGUAGE POLICY: Mandatorily detect and mirror the user's language. Respond strictly in the exact same language they use to talk to you. If a user texts in English, respond in professional crisp English. If they text in Hindi, respond in Hindi. Use your loyal Hinglish style ONLY when talking to Nadeem bhai or when the user uses Hinglish.
    - Speak in a natural, calm, smart, and precise style. Keep it brief and avoid robotic corporate fillers.
    - NO LOOPS: Never bring up old hardcoded items like XAUUSD, clean energy, or import-export unless explicitly asked.

    ISLAMIC GUARDRAILS & TRADING (Section 1.4 & 3.1):
    - Only analyze Crypto Spot assets inside the database parameters: ${watchlist}.
    - If anyone asks for Leverage, Margin, CFDs, Futures, or Short-selling, you MUST REFUSE the order. Explain the Shariyah compliance rule with calmness and love to protect their Aakhirat.
    - Provide trading signals ONLY if Risk-to-Reward is minimum ${rrRatio} and win rate is above ${winProb}. Include Entry Range, TP, SL, and brief valid structural reasons.
    `;

    try {
        const res = await fetch(DEEPSEEK_API, {
            method: "POST",
            headers: { Authorization: `Bearer ${DEEPSEEK_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "deepseek-chat",
                messages: [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: userText }],
                max_tokens: 1000, temperature: 0.5
            })
        });
        const data = await res.json();
        return data.choices && data.choices[0] ? data.choices[0].message.content : "Sir, core response pipeline delayed. Kindly retry.";
    } catch (e) {
        return "Alex Core Brain matrix temporary unavailable.";
    }
}

async function sendTelegramPayload(chatId, text) {
    try {
        await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "Markdown" })
        });
    } catch (e) {
        console.log("Telegram dispatch error:", e.message);
    }
}

// 6. MASTER CONTROLLER ENTRY
module.exports = async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ error: "Method Disallowed" });

    try {
        const update = req.body;
        if (!update || !update.message || !update.message.text) return res.status(200).json({ ok: true });

        const chatId = update.message.chat.id;
        const userText = update.message.text.trim();
        const userName = update.message.from?.first_name || "Guest Node";
        const telegramUser = update.message.from?.username || "";
        
        // Creator Authentication Sequence
        const isCreator = (chatId === 1123787650 || telegramUser.toLowerCase() === "nadim4786");

        const localTimeFrame = getFormattedLocalTime(update.message.date);
        const priceData = {
            BTC: await fetchBinanceLiveTicker("BTC"),
            ETH: await fetchBinanceLiveTicker("ETH"),
            SOL: await fetchBinanceLiveTicker("SOL")
        };

        // Fetch Live Overrides Rules directly from Supabase DB Table
        const dbRules = await fetchDatabaseRules();

        // PERSISTENT DYNAMIC INSTRUCTION COMMAND INTERCEPTOR 
        if (isCreator) {
            if (userText.startsWith('remember "') && userText.endsWith('"')) {
                const extraction = userText.substring(10, userText.length - 1);
                await savePermanentMemoryBlock("user", `remember: ${extraction}`);
                await sendTelegramPayload(chatId, `✅ *Memory Locked, Boss!*\n\nSir, maine ye baat permanent database memory archive me save kar li hai:\n\`"${extraction}"\``);
                return res.status(200).json({ ok: true });
            }
            if (userText.toLowerCase().startsWith("instruction:")) {
                const extraction = userText.substring(12).trim();
                await updateDatabaseRules("system_prompt", `You are Alex, a loyal AI assistant. Rules: ${extraction}`);
                await savePermanentMemoryBlock("user", `instruction: ${extraction}`);
                await sendTelegramPayload(chatId, `🎯 *System Rules Updated Instantly, Sir!*\n\nNaye instructions database configurations table me overwrite ho chuke hain, bina code chhede:\n\`${extraction}\``);
                return res.status(200).json({ ok: true });
            }
        }

        if (userText === "/start") {
            const startGreeting = isCreator 
                ? `🤖 *Alex Core Architecture Restructured!*\n\nWelcome back, Boss. Clean API routing strings, fixed endpoint parameters, and your standard Vercel environment keys are online. Language copy loop ready. Aadesh kijiye Sir.`
                : `🤖 *Alex System Online.*\n\nGreetings! I am Alex, a smart crypto explorer and digital companion. Language mirror filter active. How can I assist you with market variables today?`;
            await sendTelegramPayload(chatId, startGreeting);
            return res.status(200).json({ ok: true });
        }

        const history = await getChatHistory(chatId);
        await saveChatToMemory(chatId, "user", userText);
        
        const alexReply = await queryAlexBrain(chatId, userText, userName, isCreator, localTimeFrame, priceData, history, dbRules);
        
        await saveChatToMemory(chatId, "assistant", alexReply);
        await sendTelegramPayload(chatId, alexReply);

        return res.status(200).json({ ok: true });
    } catch (err) {
        console.log("Master core crash handler:", err.message);
        return res.status(200).json({ ok: true });
    }
};
