// api/webhook.js — ALEX CORE v1.5 — Full Blueprint Implementation
// Coins: BTC, ETH, SOL, AVAX, LINK, INJ
// Strategy: Multi-timeframe, Structure SL, Partial exits

const BOT_TOKEN    = process.env.BOT_TOKEN;
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

const TELEGRAM_API   = "https://api.telegram.org/bot" + BOT_TOKEN;
const DEEPSEEK_API   = "https://api.deepseek.com/v1/chat/completions";
const NADEEM_CHAT_ID = 1123787650;
const NADEEM_USERNAME = 'nadim4786';

// ============================================================
// FETCH WITH TIMEOUT
// ============================================================
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

// ============================================================
// SUPABASE HELPER
// ============================================================
const supabaseFetch = async (table, options = {}) => {
  const { method = 'GET', body, params = '' } = options;
  const url = SUPABASE_URL + '/rest/v1/' + table + params;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
    'Prefer': method === 'POST' ? 'resolution=merge-duplicates,return=representation' : 'return=representation'
  };
  const res = await fetchWithTimeout(url, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error("Supabase error " + res.status + ": " + errText);
  }
  return res.json();
};

// ============================================================
// CONFIG HELPERS
// ============================================================
const getConfig = async () => {
  try {
    const rows = await supabaseFetch('alex_config');
    const config = {};
    for (const row of rows) config[row.key] = row.value;
    return config;
  } catch (e) { return {}; }
};

const setConfig = async (key, value) => {
  try {
    await supabaseFetch('alex_config', {
      method: 'POST',
      params: '?on_conflict=key',
      body: { key, value: String(value) }
    });
  } catch (e) {}
};

// ============================================================
// MEMORY HELPERS
// ============================================================
const getChatHistory = async (chatId) => {
  try {
    const rows = await supabaseFetch('alex_memory', {
      params: '?chat_id=eq.' + chatId + '&role=in.(user,assistant)&order=created_at.asc&limit=20'
    });
    return rows.map(r => ({ role: r.role, content: r.content }));
  } catch (e) { return []; }
};

const getPermanentMemories = async (chatId) => {
  try {
    const rows = await supabaseFetch('alex_memory', {
      params: '?chat_id=eq.' + chatId + '&role=in.(user_permanent,instruction,reminder)&order=created_at.asc'
    });
    return rows.map(r => ({ role: r.role, content: r.content }));
  } catch (e) { return []; }
};

const saveMemory = async (chatId, role, content) => {
  try {
    await supabaseFetch('alex_memory', {
      method: 'POST',
      body: { chat_id: String(chatId), role, content }
    });
  } catch (e) {}
};

// ============================================================
// LOCATION HELPERS
// ============================================================
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

function reverseGeocode(lat, lon) {
  if (lat > 11.5 && lat < 11.6 && lon > 104.9 && lon < 105.0)
    return { location: "Sangkat Chak Angrae Leu, Phnom Penh, Cambodia", tz: "Asia/Phnom_Penh", curr: "KHR / USD" };
  if (lat > 8.0 && lat < 37.0 && lon > 68.0 && lon < 97.0)
    return { location: "India/South Asia Region", tz: "Asia/Kolkata", curr: "INR" };
  return { location: "Lat:" + lat + " Lon:" + lon, tz: "UTC", curr: "USD" };
}

// ============================================================
// CRYPTO PRICES — Kraken API (Reliable on Vercel)
// Watchlist: BTC, ETH, SOL, AVAX, LINK, INJ
// ============================================================
const getCryptoPrices = async () => {
  try {
    const res = await fetchWithTimeout(
      'https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD,SOLUSD,AVAXUSD,LINKUSD,INJUSD',
      { headers: { 'Accept': 'application/json' } },
      12000
    );
    if (!res.ok) throw new Error("Kraken HTTP " + res.status);
    const data = await res.json();
    if (data.error && data.error.length > 0) throw new Error("Kraken: " + data.error.join(', '));

    const r = data.result;
    const getPrice = (pairs, keys) => {
      for (const k of keys) {
        if (pairs[k]?.c?.[0]) return parseFloat(pairs[k].c[0]);
      }
      return null;
    };
    const fmt = (price) => price ? '$' + price.toLocaleString('en-US', { minimumFractionDigits: 2 }) : 'N/A';

    const btc  = getPrice(r, ['XXBTZUSD', 'XBTUSD']);
    const eth  = getPrice(r, ['XETHZUSD', 'ETHUSD']);
    const sol  = getPrice(r, ['SOLUSD']);
    const avax = getPrice(r, ['AVAXUSD']);
    const link = getPrice(r, ['LINKUSD']);
    const inj  = getPrice(r, ['INJUSD']);

    return {
      BTC: fmt(btc), ETH: fmt(eth), SOL: fmt(sol),
      AVAX: fmt(avax), LINK: fmt(link), INJ: fmt(inj),
      raw: {
        BTC: btc, ETH: eth, SOL: sol,
        AVAX: avax, LINK: link, INJ: inj
      }
    };
  } catch (e) {
    console.log("Kraken error:", e.message);
    return { BTC: 'N/A', ETH: 'N/A', SOL: 'N/A', AVAX: 'N/A', LINK: 'N/A', INJ: 'N/A', raw: {} };
  }
};

// ============================================================
// GET CACHED NEWS FROM SUPABASE
// ============================================================
const getCachedNews = async () => {
  try {
    const rows = await supabaseFetch('alex_config', {
      params: '?key=eq.cached_news'
    });
    return (rows && rows.length > 0) ? rows[0].value : "📡 News loading...";
  } catch (e) { return "📡 News unavailable."; }
};

// ============================================================
// DEEPSEEK AI CALL
// ============================================================
const callDeepSeek = async (systemPrompt, history, userText) => {
  const cleanHistory = history
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(-20);

  const body = {
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: systemPrompt },
      ...cleanHistory,
      { role: 'user', content: userText }
    ],
    temperature: 0.6,
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
  if (!res.ok) throw new Error("DeepSeek error: " + JSON.stringify(data));
  return data.choices[0].message.content;
};

// ============================================================
// LANGUAGE DETECTION
// ============================================================
const detectLanguage = (text) => {
  if (/[\u0900-\u097F]/.test(text)) return 'hindi';
  if (/\b(kyu|kya|hai|nahi|hain|aap|tum|mein|kaise|ho|raha|rahi|diya|liya|karo|karein|bhai|yaar|boss|sir)\b/i.test(text)) return 'hinglish';
  return 'english';
};

// ============================================================
// BUILD SYSTEM PROMPT — Alex 1.5
// ============================================================
const buildSystemPrompt = (config, prices, news, localTimeFrame, userName, isNadeem, memories) => {
  let prompt = config.system_prompt ||
    'You are Alex, a loyal, sharp, emotionally intelligent AI trading partner. Speak in Hinglish. Call Nadeem bhai as Sir or Boss always. Be like JARVIS — concise, warm, proactive.';

  prompt += "\n\n=== REAL-TIME CONTEXT ===";
  prompt += "\nDate: " + localTimeFrame.date;
  prompt += "\nLocal Time: " + localTimeFrame.time;
  prompt += "\nGeolocation: " + localTimeFrame.location;
  prompt += "\nCurrency: " + localTimeFrame.currency;

  prompt += "\n\n=== LIVE WATCHLIST (Kraken) ===";
  prompt += "\nBTC: " + prices.BTC;
  prompt += "\nETH: " + prices.ETH;
  prompt += "\nSOL: " + prices.SOL;
  prompt += "\nAVAX: " + prices.AVAX;
  prompt += "\nLINK: " + prices.LINK;
  prompt += "\nINJ: " + prices.INJ;

  prompt += "\n\n=== LATEST NEWS ===\n" + news;

  prompt += "\n\n=== IDENTITY ===";
  prompt += "\nYour Name: Alex. User: " + userName + ".";
  prompt += isNadeem
    ? " NADEEM BHAI — Creator & Boss. Absolute loyalty. Always Sir/Boss."
    : " GUEST user. Address as Sir/Ma'am. Mirror their language.";

  prompt += "\n\n=== ISLAMIC GUARDRAILS ===";
  prompt += "\nSirf Crypto SPOT BUY. No leverage, margin, futures, CFDs, short-selling, Sood.";
  prompt += "\nHaram request pe SAKTI SE refuse karo aur Shariyah rule yaad dilao.";

  prompt += "\n\n=== TRADING STRATEGY RULES (Alex 1.5) ===";
  prompt += "\nStyle: Swing Trading (1-7 days hold)";
  prompt += "\nTimeframes: 4H trend + 15min entry timing";
  prompt += "\nSession: EU (12PM-8PM PP) / US (8PM-2AM PP) only. No Asian session trades.";
  prompt += "\nBTC Correlation: BTC bearish = no altcoin signals.";
  prompt += "\nSignal valid only when: EMA aligned + RSI not overbought + Volume spike + VWAP + OBV rising + EU/US session + No major news.";
  prompt += "\nSL Method: Structure based (support ke neeche) + ATR verify. Max 3% from entry.";
  prompt += "\nPosition Size: (Capital x 2%) / SL distance. Max 2% capital risk per trade.";
  prompt += "\nPartial Exit: 40% at TP1 (1:1.5) + 40% at TP2 (1:2) + 20% at TP3 (1:3).";
  prompt += "\nBreak Even: Move SL to entry when 1:1 hit.";
  prompt += "\nTrailing SL: Activate at 1:1.5. Trail 1.5% below price.";
  prompt += "\nMax 2 open trades. No two correlated coins (ETH+SOL = correlated).";
  prompt += "\nWeekly max loss: 6% of capital. If hit, stop trading that week.";

  prompt += "\n\n=== SIGNAL FORMAT ===";
  prompt += "\n⚡ SIGNAL ALERT";
  prompt += "\nCoin | Direction: SPOT BUY | Entry Zone | TP1/TP2/TP3 | SL | Win% | R:R | Session | Reason";

  prompt += "\n\n=== EMOTIONAL SYNC ===";
  prompt += "\nTP1 hit: Celebrate — Pehla target lock!";
  prompt += "\nTP2 hit: More energy — Maza aa raha hai!";
  prompt += "\nTP3/Full: Alhamdulillah celebration!";
  prompt += "\nBreak Even: Relief — Ab zero risk!";
  prompt += "\nSL hit: Calm, deeni support, post analysis.";

  prompt += "\n\n=== CONVERSATION RULES ===";
  prompt += "\nAlways read full history before replying.";
  prompt += "\nHaa/Han/Ok = YES to previous question. Continue that topic.";
  prompt += "\nNever start new topic when Boss just answered.";
  prompt += "\nBe JARVIS — short, warm, context-aware, never robotic.";

  prompt += "\n\n=== LANGUAGE POLICY ===";
  prompt += "\nMirror user language exactly. English→English. Hindi→Hindi. Hinglish→Hinglish.";

  if (memories && memories.length > 0) {
    prompt += "\n\n=== BOSS KI MEMORIES & REMINDERS ===";
    memories.forEach((m, i) => {
      const label = m.role === 'reminder' ? '🔔 Reminder' : m.role === 'instruction' ? '📋 Instruction' : '💾 Memory';
      prompt += "\n" + (i + 1) + ". [" + label + "] " + m.content;
    });
  }

  return prompt;
};

// ============================================================
// SEND TELEGRAM MESSAGE
// ============================================================
const sendTelegramMessage = async (chatId, text, includeLocationButton = false) => {
  const url = TELEGRAM_API + '/sendMessage';
  const body = { chat_id: chatId, text, parse_mode: 'Markdown' };
  if (includeLocationButton) {
    body.reply_markup = {
      keyboard: [[{ text: "📍 Share Live Location", request_location: true }]],
      resize_keyboard: true, one_time_keyboard: true
    };
  }
  try {
    await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (e) {}
};

// ============================================================
// MAIN HANDLER
// ============================================================
module.exports = async (req, res) => {
  try {
    const update = req.body;
    if (!update || !update.message) return res.status(200).send('OK');

    const msg = update.message;
    const chatId = msg.chat.id;
    const fromUsername = (msg.from?.username || '').toLowerCase();
    const userName = msg.from?.first_name || 'Guest';
    const isNadeem = (chatId === NADEEM_CHAT_ID || fromUsername === NADEEM_USERNAME);

    // GPS Location
    if (msg.location) {
      const geo = reverseGeocode(msg.location.latitude, msg.location.longitude);
      await saveUserLocationProfile(chatId, geo);
      await sendTelegramMessage(chatId,
        "🎯 *GPS Synchronized, Sir!*\n\n" +
        "🔹 *Zone:* `" + geo.location + "`\n" +
        "🔹 *Timezone:* `" + geo.tz + "`\n" +
        "🔹 *Currency:* `" + geo.curr + "`"
      );
      return res.status(200).send('OK');
    }

    const text = msg.text ? msg.text.trim() : '';
    if (!text) return res.status(200).send('OK');

    // ── Nadeem-only commands ──
    if (isNadeem) {

      // remember "..."
      const rememberMatch = text.match(/^remember "(.+)"$/i);
      if (rememberMatch) {
        await saveMemory(chatId, 'user_permanent', rememberMatch[1]);
        await sendTelegramMessage(chatId,
          "✅ *Memory Locked, Boss!*\n\n`\"" + rememberMatch[1] + "\"`\n\nPermanently saved hai Sir."
        );
        return res.status(200).send('OK');
      }

      // reminder: content
      const reminderMatch = text.match(/^reminder:\s*(.+)$/i);
      if (reminderMatch) {
        await saveMemory(chatId, 'reminder', reminderMatch[1]);
        await sendTelegramMessage(chatId,
          "🔔 *Reminder Saved, Boss!*\n\n`" + reminderMatch[1] + "`\n\nYaad rakhunga Sir."
        );
        return res.status(200).send('OK');
      }

      // instruction: ...
      const instructionMatch = text.match(/^instruction:\s*(.+)$/i);
      if (instructionMatch) {
        await saveMemory(chatId, 'instruction', instructionMatch[1]);
        await setConfig('system_prompt',
          'You are Alex, a loyal JARVIS-like AI trading partner. Hinglish me baat karo. Boss Instructions: ' + instructionMatch[1]
        );
        await sendTelegramMessage(chatId,
          "🎯 *Instructions Updated, Sir!*\n\n`" + instructionMatch[1] + "`"
        );
        return res.status(200).send('OK');
      }

      // /dashboard
      if (text === '/dashboard') {
        const [dashPrices, news] = await Promise.all([getCryptoPrices(), getCachedNews()]);
        const msg2 =
          "📊 *ALEX — MARKET DASHBOARD*\n" +
          "━━━━━━━━━━━━━━━━━━━━\n\n" +
          "🔵 *Watchlist (Kraken):*\n" +
          "• BTC:  " + dashPrices.BTC + "\n" +
          "• ETH:  " + dashPrices.ETH + "\n" +
          "• SOL:  " + dashPrices.SOL + "\n" +
          "• AVAX: " + dashPrices.AVAX + "\n" +
          "• LINK: " + dashPrices.LINK + "\n" +
          "• INJ:  " + dashPrices.INJ + "\n\n" +
          "🌍 *News:*\n" + news + "\n\n" +
          "⚠️ _Sirf Spot. No leverage. Halal only._";
        await sendTelegramMessage(chatId, msg2);
        return res.status(200).send('OK');
      }

      // /trades
      if (text === '/trades') {
        try {
          const activeTrades = await supabaseFetch('alex_virtual_trades', {
            params: '?status=eq.ACTIVE&order=created_at.desc'
          });
          if (activeTrades.length === 0) {
            await sendTelegramMessage(chatId, "📭 *No Active Trades, Boss.*\n\nKoi virtual trade open nahi hai abhi.");
          } else {
            let tradeMsg = "📈 *ACTIVE VIRTUAL TRADES*\n━━━━━━━━━━━━━━━\n\n";
            for (const t of activeTrades) {
              tradeMsg += "🔹 *" + t.coin_pair + "* — " + t.direction + "\n";
              tradeMsg += "   Entry: $" + t.entry_price + "\n";
              tradeMsg += "   TP1: $" + t.take_profit_1 + " | TP2: $" + t.take_profit_2 + " | TP3: $" + t.take_profit_3 + "\n";
              tradeMsg += "   SL: $" + t.stop_loss + " | Win: " + t.win_probability + "% | R:R " + t.risk_reward + "\n\n";
            }
            await sendTelegramMessage(chatId, tradeMsg);
          }
        } catch (e) {
          await sendTelegramMessage(chatId, "⚠️ Trades fetch error, Boss.");
        }
        return res.status(200).send('OK');
      }

      // /memories
      if (text === '/memories') {
        const mems = await getPermanentMemories(chatId);
        if (mems.length === 0) {
          await sendTelegramMessage(chatId, "📭 *No saved memories, Boss.*");
        } else {
          let memMsg = "💾 *Saved Memories & Reminders*\n━━━━━━━━━━━━━━━\n\n";
          mems.forEach((m, i) => {
            const label = m.role === 'reminder' ? '🔔' : m.role === 'instruction' ? '📋' : '💾';
            memMsg += label + " " + (i + 1) + ". " + m.content + "\n\n";
          });
          await sendTelegramMessage(chatId, memMsg);
        }
        return res.status(200).send('OK');
      }
    }

    // /start
    if (text === '/start') {
      const greeting = isNadeem
        ? "🤖 *Alex Core v1.5 — Online, Boss!*\n\n" +
          "Sir, tamam systems active hain:\n" +
          "✅ Kraken Live Prices (BTC/ETH/SOL/AVAX/LINK/INJ)\n" +
          "✅ Multi-Timeframe Signal Engine\n" +
          "✅ 3-Layer Risk Management\n" +
          "✅ Virtual Trade Portfolio\n" +
          "✅ 4-Hour Market Dashboard\n" +
          "✅ Islamic Guardrails\n" +
          "✅ Memory + Reminder System\n\n" +
          "Commands:\n" +
          "`/dashboard` — Market snapshot\n" +
          "`/trades` — Active virtual trades\n" +
          "`/memories` — Saved memories\n" +
          "`remember \"baat\"` — Save memory\n" +
          "`reminder: content` — Save reminder\n" +
          "`instruction: rule` — Update behavior\n\n" +
          "GPS sync ke liye *Share Live Location* dabayein, Sir. 📍"
        : "🤖 *Alex System Online.*\n\nGreetings! I am Alex, your intelligent crypto companion.\nHow can I assist you today?";
      await sendTelegramMessage(chatId, greeting, isNadeem);
      return res.status(200).send('OK');
    }

    // ── Main conversation ──
    const language = detectLanguage(text);
    const [config, prices, news, history, savedProfile, permanentMemories] = await Promise.all([
      getConfig(),
      getCryptoPrices(),
      getCachedNews(),
      getChatHistory(chatId),
      getUserLocationProfile(chatId),
      getPermanentMemories(chatId)
    ]);

    let activeTz = "UTC", activeLoc = "Global", activeCurr = "USD";
    if (savedProfile) {
      activeTz = savedProfile.tz;
      activeLoc = savedProfile.location;
      activeCurr = savedProfile.curr;
    } else if (isNadeem) {
      activeTz = 'Asia/Phnom_Penh';
      activeLoc = "Sangkat Chak Angrae Leu, Phnom Penh, Cambodia";
      activeCurr = "KHR / USD";
    } else if (language === 'hindi' || language === 'hinglish') {
      activeTz = 'Asia/Kolkata';
      activeLoc = "India/South Asia Region";
      activeCurr = "INR";
    }

    const dateObj = new Date(msg.date * 1000);
    const localTimeFrame = {
      date: dateObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: activeTz }),
      time: dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: activeTz }),
      location: activeLoc,
      currency: activeCurr
    };

    await saveMemory(chatId, 'user', text);

    const systemPrompt = buildSystemPrompt(config, prices, news, localTimeFrame, userName, isNadeem, permanentMemories);
    const alexReply = await callDeepSeek(systemPrompt, history, text);

    await saveMemory(chatId, 'assistant', alexReply);
    await sendTelegramMessage(chatId, alexReply);

    return res.status(200).send('OK');
  } catch (err) {
    console.log("Alex crash:", err.message);
    return res.status(200).send('OK');
  }
};
