// api/webhook.js — Ultimate Production-Ready Serverless Webhook Handler for Alex

// All secrets from Vercel Environment Variables (never hardcode)
const BOT_TOKEN = process.env.BOT_TOKEN;
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

const TELEGRAM_API = "https://api.telegram.org/bot" + BOT_TOKEN;
const DEEPSEEK_API = "https://api.deepseek.com/v1/chat/completions";

// ---------- Helper: fetch with timeout ----------
const fetchWithTimeout = async (url, options = {}, timeout = 25000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
};

// ---------- Supabase REST helpers ----------
const supabaseFetch = async (table, options = {}) => {
  const { method = 'GET', body, params = '' } = options;
  const url = SUPABASE_URL + '/rest/v1/' + table + params;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
  const res = await fetchWithTimeout(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error("Supabase error status: " + res.status);
  return res.json();
};

// ---------- Fetch config from alex_config ----------
const getConfig = async () => {
  try {
    const rows = await supabaseFetch('alex_config');
    const config = {};
    for (const row of rows) {
      config[row.key] = row.value;
    }
    return config;
  } catch (e) { return {}; }
};

// ---------- Chat memory management ----------
const CHAT_HISTORY_LIMIT = 20;

const getChatHistory = async (chatId) => {
  try {
    const rows = await supabaseFetch('alex_memory', {
      params: '?chat_id=eq.' + chatId + '&order=created_at.asc&limit=' + CHAT_HISTORY_LIMIT
    });
    return rows.map(r => ({ role: r.role, content: r.content }));
  } catch (e) { return []; }
};

const saveChatMessage = async (chatId, role, content) => {
  try {
    await supabaseFetch('alex_memory', {
      method: 'POST',
      body: { chat_id: String(chatId), role: role, content: content }
    });
  } catch (e) {}
};

const getUserLocationProfile = async (chatId) => {
  try {
    const rows = await supabaseFetch('alex_config', {
      params: '?key=eq.loc_' + chatId
    });
    return (rows && rows.length > 0) ? JSON.parse(rows[0].value) : null;
  } catch (e) { return null; }
};

const saveUserLocationProfile = async (chatId, profileData) => {
  try {
    await supabaseFetch('alex_config', {
      method: 'POST',
      params: '?on_conflict=key',
      body: { key: 'loc_' + chatId, value: JSON.stringify(profileData) }
    });
  } catch (e) {}
};

// ---------- Live crypto prices from CoinGecko (no regional blocks) ----------
const getCryptoPrices = async () => {
  try {
    const res = await fetchWithTimeout(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd'
    );
    if (!res.ok) throw new Error("CoinGecko HTTP " + res.status);
    const data = await res.json();
    return {
      BTC: data.bitcoin.usd.toLocaleString('en-US', { minimumFractionDigits: 2 }),
      ETH: data.ethereum.usd.toLocaleString('en-US', { minimumFractionDigits: 2 }),
      SOL: data.solana.usd.toLocaleString('en-US', { minimumFractionDigits: 2 })
    };
  } catch (e) {
    return { BTC: "Offline", ETH: "Offline", SOL: "Offline" };
  }
};

// ---------- Language detection ----------
const detectLanguage = (text) => {
  if (/[\u0900-\u097F]/.test(text)) return 'hindi';
  if (/\b(kyu|kya|hai|nahi|hain|aap|tum|mein|kaise|ho|raha|rahi|diya|liya|karo|karein)\b/i.test(text)) return 'hinglish';
  return 'english';
};

// ---------- Reverse Geocoding Map Framework ----------
function fetchReverseGeocoding(lat, lon) {
  if (lat > 11.5 && lat < 11.6 && lon > 104.9 && lon < 105.0) {
    return { location: "Sangkat Chak Angrae Leu, Phnom Penh, Cambodia", tz: "Asia/Phnom_Penh", curr: "Khmer Riel (KHR) / USD" };
  }
  if (lat > 8.0 && lat < 37.0 && lon > 68.0 && lon < 97.0) {
    return { location: "India/South Asia Region", tz: "Asia/Kolkata", curr: "Indian Rupee (INR)" };
  }
  return { location: "Coordinates [Lat: " + lat + ", Lon: " + lon + "]", tz: "UTC", curr: "USD (Standard)" };
}

// ---------- DeepSeek API call ----------
const callDeepSeek = async (systemPrompt, history, userText) => {
  // Only valid roles for DeepSeek: user / assistant
  const cleanHistory = history
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: m.content }));

  const body = {
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: systemPrompt },
      ...cleanHistory,
      { role: 'user', content: userText }
    ],
    temperature: 0.5,
    max_tokens: 1000
  };

  const res = await fetchWithTimeout(DEEPSEEK_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + DEEPSEEK_KEY
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (!res.ok) throw new Error("DeepSeek transaction declined: " + JSON.stringify(data));
  return data.choices[0].message.content;
};

// ---------- Send Telegram message ----------
const sendTelegramMessage = async (chatId, text, includeLocationButton = false) => {
  const url = TELEGRAM_API + '/sendMessage';
  const body = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
  if (includeLocationButton) {
    body.reply_markup = {
      keyboard: [[{ text: "📍 Share Live Location", request_location: true }]],
      resize_keyboard: true,
      one_time_keyboard: true
    };
  }
  await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
};

// ---------- Main handler ----------
module.exports = async (req, res) => {
  try {
    const update = req.body;
    if (!update || !update.message) return res.status(200).send('OK');

    const msg = update.message;
    const chatId = msg.chat.id;
    const fromUsername = msg.from?.username || '';
    const userName = msg.from?.first_name || 'Guest Node';

    const isNadeem = (chatId === 1123787650 || fromUsername.toLowerCase() === 'nadim4786');

    // Handle incoming GPS location
    if (msg.location) {
      const geoProfile = fetchReverseGeocoding(msg.location.latitude, msg.location.longitude);
      await saveUserLocationProfile(chatId, geoProfile);
      await sendTelegramMessage(chatId,
        "🎯 *Map GPS Synchronized, Sir!*\n\nAlex tracking system has saved your profile:\n🔹 *Zone:* `" + geoProfile.location + "`\n🔹 *Timezone:* `" + geoProfile.tz + "`\n\nAb se aapka data isi location matrix par automatic chalega!"
      );
      return res.status(200).send('OK');
    }

    const text = msg.text ? msg.text.trim() : '';
    if (!text) return res.status(200).send('OK');

    if (isNadeem) {
      const rememberMatch = text.match(/^remember "(.+)"$/);
      if (rememberMatch) {
        const content = rememberMatch[1];
        await saveChatMessage(chatId, 'user_permanent', content);
        await sendTelegramMessage(chatId,
          "✅ *Memory Locked, Boss!*\n\nSir, maine ye baat database layer me permanently archive kar li hai:\n`\"" + content + "\"`"
        );
        return res.status(200).send('OK');
      }

      const instructionMatch = text.match(/^instruction:\s*(.+)$/);
      if (instructionMatch) {
        const newPrompt = instructionMatch[1];
        await supabaseFetch('alex_config', {
          method: 'POST',
          params: '?on_conflict=key',
          body: { key: 'system_prompt', value: "You are Alex, a loyal AI assistant. Current regulations: " + newPrompt }
        });
        await sendTelegramMessage(chatId,
          "🎯 *System Rules Updated Instantly, Sir!*\n\nNaye instructions config table me write ho chuke hain."
        );
        return res.status(200).send('OK');
      }
    }

    if (text === "/start") {
      const startGreeting = isNadeem
        ? "🤖 *Alex Core Static Build Active!*\n\nWelcome back, Boss. Satellite GPS mapping, CoinGecko real-time tickers, and live Supabase config rules are online. Mobile hardware GPS sync karne ke liye niche diye gaye *Share Live Location* button par click kijiye, Sir."
        : "🤖 *Alex System Online.*\n\nGreetings! I am Alex, a real-time smart crypto companion. Language mirror filter active. How can I assist you with market variables today?";
      await sendTelegramMessage(chatId, startGreeting, isNadeem);
      return res.status(200).send('OK');
    }

    const language = detectLanguage(text);
    const config = await getConfig();
    const prices = await getCryptoPrices();
    const history = await getChatHistory(chatId);
    const savedProfile = await getUserLocationProfile(chatId);

    let activeTz = "UTC";
    let activeLoc = "Global (UTC Framework)";
    let activeCurr = "US Dollar (USD)";

    if (savedProfile) {
      activeTz = savedProfile.tz;
      activeLoc = savedProfile.location;
      activeCurr = savedProfile.curr;
    } else if (isNadeem) {
      activeTz = 'Asia/Phnom_Penh';
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

    await saveChatMessage(chatId, 'user', text);

    let systemPrompt = config.system_prompt || 'You are Alex, a loyal smart companion. Speak in Hinglish.';
    systemPrompt += "\nREAL-TIME CONTEXT: Date: " + localTimeFrame.date + " | Local Time: " + localTimeFrame.time + " | Geolocation: " + localTimeFrame.location + " | Currency: " + localTimeFrame.currency;
    systemPrompt += "\nLive Rates: Bitcoin: $" + prices.BTC + " | Ethereum: $" + prices.ETH + " | Solana: $" + prices.SOL;
    systemPrompt += "\nYour Name: Alex. User Name: " + userName + ". Identity: " + (isNadeem ? "NADEEM BHAI (Creator/Boss). Address him with absolute loyalty as Sir or Boss hamesha." : "GUEST user. Address as Sir/Ma'am initially.");
    systemPrompt += "\nLANGUAGE POLICY: Detect and mirror the user's language strictly. If English, reply in English. If Hindi, reply in Hindi. Hinglish is reserved for Nadeem bhai or when the user uses it.";
    systemPrompt += "\nISLAMIC GUARDRAILS: Only analyze Crypto Spot. Refuse leverage, margin, futures, CFDs, and interest (Sood) with love and calmness to protect their Aakhirat. Ensure Risk-to-Reward >= 1:3 and win probability > 70% for signals.";

    const alexReply = await callDeepSeek(systemPrompt, history, text);

    await saveChatMessage(chatId, 'assistant', alexReply);
    await sendTelegramMessage(chatId, alexReply);

    return res.status(200).send('OK');
  } catch (err) {
    console.log("Master handler loop crash block:", err.message);
    return res.status(200).send('OK');
  }
};
