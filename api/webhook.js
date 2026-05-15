const BOT_TOKEN = process.env.BOT_TOKEN;
const DEEPSEEK_API = `https://deepseek.com`;
const SUPABASE_URL = process.env.SUPABASE_URL ? process.env.SUPABASE_URL.replace(/\/+$/, '') : ''; 
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY; 
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;

// 1. SECURE STORAGE LOG MATRIX (With Local Settings Persistence per User)
async function getChatHistory(chatId) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/alex_memory?chat_id=eq.${chatId}&order=created_at.asc&limit=20`, {
            headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
        });
        const rows = await res.json();
        return Array.isArray(rows) ? rows.map(r => ({ role: r.role, content: r.content })) : [];
    } catch (e) { return []; }
}

async function saveChatMessage(chatId, role, content) {
    try {
        await fetch(`${SUPABASE_URL}/rest/v1/alex_memory`, {
            method: "POST",
            headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: String(chatId), role: role, content: content })
        });
    } catch (e) {}
}

// 2. FETCH STORED PROFILE LOCATIONS (Bina baar-baar poochhe automatic load karna)
async function getUserLocationProfile(chatId) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/alex_config?key=eq.loc_${chatId}`, {
            headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
        });
        const data = await res.json();
        return (data && data.length > 0) ? JSON.parse(data[0].value) : null;
    } catch (e) { return null; }
}

async function saveUserLocationProfile(chatId, profileData) {
    try {
        await fetch(`${SUPABASE_URL}/rest/v1/alex_config`, {
            method: "POST",
            headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ key: `loc_${chatId}`, value: JSON.stringify(profileData) })
        });
    } catch (e) {}
}

// 3. GOOGLE MAPS API SIMULATION (Dynamic Reverse Coordinates Tracker)
async function fetchReverseGeocoding(lat, lon) {
    try {
        // Dynamic detection matrix based on your structural positioning metadata
        if (lat > 11.5 && lat < 11.6 && lon > 104.9 && lon < 105.0) {
            return { location: "Sangkat Chak Angrae Leu, Phnom Penh, Cambodia", tz: "Asia/Phnom_Penh", curr: "Khmer Riel (KHR) / USD" };
        }
        if (lat > 8.0 && lat < 37.0 && lon > 68.0 && lon < 97.0) {
            return { location: "India/South Asia Region", tz: "Asia/Kolkata", curr: "Indian Rupee (INR)" };
        }
        return { location: `Coordinates [Lat: ${lat}, Lon: ${lon}]`, tz: "UTC", curr: "USD (Standard)" };
    } catch (e) {
        return { location: "Global (Standard Network Node)", tz: "UTC", curr: "USD" };
    }
}

// 4. BULLETPROOF BINANCE CORE PRICES FEED
async function fetchBinanceLiveTicker(symbol) {
    try {
        const response = await fetch(`https://binance.com{symbol}USDT`);
        const data = await response.json();
        if (data && data.price) {
            return parseFloat(data.price).toLocaleString('en-US', { minimumFractionDigits: 2 });
        }
        return "Offline";
    } catch (e) { return "Timeout"; }
}

const detectLanguage = (text) => {
    if (/[\u0900-\u097F]/.test(text)) return 'hindi';
    if (/\b(kyu|kya|hai|nahi|hain|aap|tum|mein|kaise|ho|raha|rahi|diya|liya|karo|karein)\b/i.test(text)) return 'hinglish';
    return 'english';
};

// 5. DEEPSEEK ARCHITECTURE WITH ON-DEMAND GEOLOCATION ROUTING
async function queryAlexBrain(chatId, userText, userName, isCreator, localTimeFrame, priceData, history) {
    const systemPrompt = `
    You are Alex, a loyal, mature, highly capable AI assistant and trading companion.
    
    REAL-TIME REVERSED GEOCODING MAP DATA (DYNAMIC CONTEXT):
    - Current Real-Time Date: ${localTimeFrame.date}
    - Current Local User Time: ${localTimeFrame.time}
    - Map Geolocation Verified: ${localTimeFrame.location}
    - Dynamic Local Currency Output: ${localTimeFrame.currency}
    - Live Cryptocurrency Rates: Bitcoin: $${priceData.BTC} | Ethereum: $${priceData.ETH} | Solana: $${priceData.SOL}
    
    IDENTITY PROTOCOLS:
    - Your Name is ALWAYS: Alex. You are the AI Agent.
    - IDENTITY CHECK: ${isCreator ? "This user is NADEEM BHAI (Your Boss). Address him hamesha as 'Sir' or 'Boss' with high respect. Never ask him for location data!" : `The user is a GUEST named ${userName}. Address them initially as Sir/Ma'am.`}
    - NEVER ask the user to type their location. If they ask about time or currency, use the map parameters above. If the context says 'Standard UTC', calmly tell them they can send their live location pin via Telegram anytime to automatically sync their timezone.

    BEHAVIOR & LANGUAGE MIRRORING RULES:
    - Detect and mirror the user's language strictly (English, Hindi, or Hinglish). Keep it brief, smart, and to-the-point. Avoid robotic fillers.
    - Only analyze Crypto Spot assets. Reject leverage, futures, or CFDs.
    `;

    try {
        const res = await fetch(DEEPSEEK_API, {
            method: "POST",
            headers: { Authorization: `Bearer ${DEEPSEEK_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "deepseek-chat",
                messages: [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: userText }],
                max_tokens: 1000, temperature: 0.4
            })
        });
        const data = await res.json();
        return data.choices && data.choices[0] ? data.choices[0].message.content : "Sir, processing engine delay occurred. Kindly retry.";
    } catch (e) { return "Alex Brain Matrix offline."; }
}

async function sendTelegramPayload(chatId, text, includeLocationButton = false) {
    try {
        const body = { chat_id: chatId, text: text, parse_mode: "Markdown" };
        if (includeLocationButton) {
            body.reply_markup = {
                keyboard: [[{ text: "📍 Share Live Location", request_location: true }]],
                resize_keyboard: true, one_time_keyboard: true
            };
        }
        await fetch(`https://telegram.org{BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
    } catch (e) {}
}

// 6. MASTER WEBHOOK ROUTER
module.exports = async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ error: "Method Disallowed" });

    try {
        const update = req.body;
        if (!update || !update.message) return res.status(200).json({ ok: true });

        const msg = update.message;
        const chatId = msg.chat.id;
        const userName = msg.from?.first_name || "Guest Node";
        const telegramUser = msg.from?.username || "";
        const isCreator = (chatId === 1123787650 || telegramUser.toLowerCase() === "nadim4786");

        // INTERCEPTOR: Handle Incoming Location Pin Shared from Phone Hardware GPS
        if (msg.location) {
            const lat = msg.location.latitude;
            const lon = msg.location.longitude;
            const geoProfile = await fetchReverseGeocoding(lat, lon);
            await saveUserLocationProfile(chatId, geoProfile);
            
            await sendTelegramPayload(chatId, `🎯 *Map GPS Synchronized successfully, Sir!*\n\nAlex tracking system has saved your new location profile:\n🔹 *Zone:* \`${geoProfile.location}\`\n🔹 *Timezone:* \`${geoProfile.tz}\`\n\nAb se aapka saara data isi location framework par automatic chalega!`);
            return res.status(200).json({ ok: true });
        }

        const userText = msg.text ? msg.text.trim() : "";
        if (!userText) return res.status(200).json({ ok: true });

        // Load or Estimate User Timezone Profile
        const savedProfile = await getUserLocationProfile(chatId);
        const language = detectLanguage(userText);
        
        let activeTz = "UTC";
        let activeLoc = "Global (UTC Framework)";
        let activeCurr = "US Dollar (USD)";

        if (savedProfile) {
            activeTz = savedProfile.tz;
            activeLoc = savedProfile.location;
            activeCurr = savedProfile.curr;
        } else if (isCreator) {
            activeTz = 'Asia/Phnom_Penh'; // Default for Boss until location button is clicked
            activeLoc = "Sangkat Chak Angrae Leu, Phnom Penh, Cambodia";
            activeCurr = "Khmer Riel (KHR) aur US Dollar (USD)";
        } else if (language === 'hindi' || language === 'hinglish') {
            activeTz = 'Asia/Kolkata';
            activeLoc = "India/South Asia Region";
            activeCurr = "Indian Rupee (INR)";
        }

        const dateObj = new Date(msg.date * 1000);
        const localTimeFrame = {
            date: dateObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: activeTz }),
            time: dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: activeTz }),
            location: activeLoc,
            currency: activeCurr
        };

        const priceData = {
            BTC: await fetchBinanceLiveTicker("BTC"),
            ETH: await fetchBinanceLiveTicker("ETH"),
            SOL: await fetchBinanceLiveTicker("SOL")
        };

        const history = await getChatHistory(chatId);
        await saveChatMessage(chatId, "user", userText);

        if (userText === "/start") {
            const startMsg = `🤖 *Alex Active Map Engine Core Online!*\n\nSir, mobile ka hardware GPS sync karne ke liye neeche diye gaye *Share Live Location* button par click kijiye. Isse market, time aur location automatic lock ho jayenge, bina kisi file code chhede!`;
            await sendTelegramPayload(chatId, startMsg, true);
            return res.status(200).json({ ok: true });
        }

        const alexReply = await queryAlexBrain(chatId, userText, userName, isCreator, localTimeFrame, priceData, history);
        
        await saveChatMessage(chatId, "assistant", alexReply);
        await sendTelegramPayload(chatId, alexReply);

        return res.status(200).json({ ok: true });
    } catch (err) {
        return res.status(200).json({ ok: true });
    }
};
