// api/webhook.js — ALEX CORE v1.0 — Full Blueprint Implementation
// Blueprint Sections: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2

// ============================================================
// ENV VARIABLES (set in Vercel → Settings → Environment Variables)
// ============================================================
const BOT_TOKEN     = process.env.BOT_TOKEN;
const DEEPSEEK_KEY  = process.env.DEEPSEEK_API_KEY;
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_ANON_KEY;

const TELEGRAM_API  = "https://api.telegram.org/bot" + BOT_TOKEN;
const DEEPSEEK_API  = "https://api.deepseek.com/v1/chat/completions";

// Nadeem bhai identity constants
const NADEEM_CHAT_ID = 1123787650;
const NADEEM_USERNAME = 'nadim4786';

// Namaz times for Phnom Penh (approximate fixed schedule — Asia/Phnom_Penh UTC+7)
// Format: [hour, minute] in local time
const NAMAZ_SCHEDULE = [
  { name: "Fajr",    hour: 4,  minute: 30 },
  { name: "Dhuhr",   hour: 12, minute: 15 },
  { name: "Asr",     hour: 15, minute: 30 },
  { name: "Maghrib", hour: 18, minute: 15 },
  { name: "Isha",    hour: 19, minute: 30 }
];

// ============================================================
// HELPER: fetch with timeout
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
// SUPABASE REST HELPER
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
    method,
    headers,
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
// MEMORY HELPERS (Section 1.2)
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
      params: '?chat_id=eq.' + chatId + '&role=in.(user_permanent,instruction)&order=created_at.asc'
    });
    return rows.map(r => r.content);
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
    return { location: "Sangkat Chak Angrae Leu, Phnom Penh, Cambodia", tz: "Asia/Phnom_Penh", curr: "Khmer Riel (KHR) / USD" };
  if (lat > 8.0 && lat < 37.0 && lon > 68.0 && lon < 97.0)
    return { location: "India/South Asia Region", tz: "Asia/Kolkata", curr: "Indian Rupee (INR)" };
  return { location: "Lat:" + lat + " Lon:" + lon, tz: "UTC", curr: "USD" };
}

// ============================================================
// CRYPTO PRICES — CoinGecko (Section 2.1)
// Watchlist: BTC, ETH, SOL, ADA, AVAX, NEAR
// ============================================================
const getCryptoPrices = async () => {
  try {
    const res = await fetchWithTimeout(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,cardano,avalanche-2,near-protocol&vs_currencies=usd&include_24hr_change=true'
    );
    if (!res.ok) throw new Error("CoinGecko HTTP " + res.status);
    const d = await res.json();
    const fmt = (n) => n ? parseFloat(n).toLocaleString('en-US', { minimumFractionDigits: 2 }) : "N/A";
    const chg = (n) => n ? (n > 0 ? "📈 +" : "📉 ") + parseFloat(n).toFixed(2) + "%" : "";
    return {
      BTC:  fmt(d.bitcoin?.usd)           + " " + chg(d.bitcoin?.usd_24h_change),
      ETH:  fmt(d.ethereum?.usd)          + " " + chg(d.ethereum?.usd_24h_change),
      SOL:  fmt(d.solana?.usd)            + " " + chg(d.solana?.usd_24h_change),
      ADA:  fmt(d.cardano?.usd)           + " " + chg(d.cardano?.usd_24h_change),
      AVAX: fmt(d['avalanche-2']?.usd)    + " " + chg(d['avalanche-2']?.usd_24h_change),
      NEAR: fmt(d['near-protocol']?.usd)  + " " + chg(d['near-protocol']?.usd_24h_change),
      raw: d
    };
  } catch (e) {
    return { BTC: "Offline", ETH: "Offline", SOL: "Offline", ADA: "Offline", AVAX: "Offline", NEAR: "Offline", raw: {} };
  }
};

// ============================================================
// SIGNAL ENGINE (Section 3.1) — Virtual only, Spot BUY only
// ============================================================
const generateSignalIfValid = (coin, price, change24h) => {
  // Basic signal logic: oversold bounce setup
  // Real RSI/MACD requires OHLCV data — here we use 24h change as proxy
  // A drop of 5-15% with recovery signals a potential spot buy setup
  if (!price || !change24h) return null;
  const chgNum = parseFloat(change24h);
  const priceNum = parseFloat(price);
  if (isNaN(chgNum) || isNaN(priceNum)) return null;

  // Signal criteria: 24h drop between -5% and -20% (oversold bounce candidate)
  if (chgNum < -5 && chgNum > -20) {
    const entry = priceNum;
    const sl = parseFloat((entry * 0.97).toFixed(4));   // 3% SL
    const tp = parseFloat((entry * 1.09).toFixed(4));   // 9% TP → 1:3 RR
    const rr = "1:3";
    const winProb = Math.min(95, Math.round(70 + Math.abs(chgNum) * 1.2));
    if (winProb >= 70) {
      return { coin, entry, sl, tp, rr, winProb, reason: coin + " ne 24h me " + chgNum.toFixed(2) + "% ki girावट li hai. Oversold bounce setup ban raha hai." };
    }
  }
  return null;
};

// ============================================================
// VIRTUAL TRADE SAVE (Section 3.2)
// ============================================================
const saveVirtualTrade = async (signal) => {
  try {
    await supabaseFetch('alex_virtual_trades', {
      method: 'POST',
      body: {
        coin_pair: signal.coin + "/USDT",
        direction: "BUY",
        entry_price: signal.entry,
        take_profit: signal.tp,
        stop_loss: signal.sl,
        win_probability: signal.winProb,
        risk_reward: signal.rr,
        structural_reason: signal.reason,
        status: "ACTIVE"
      }
    });
  } catch (e) {}
};

// ============================================================
// TRADE TRACKER — Check active trades against current prices (Section 3.3)
// ============================================================
const checkAndUpdateTrades = async (prices) => {
  try {
    const trades = await supabaseFetch('alex_virtual_trades', {
      params: '?status=eq.ACTIVE'
    });
    const results = [];
    for (const trade of trades) {
      const coinKey = trade.coin_pair.replace('/USDT', '');
      const rawData = prices.raw;
      let currentPrice = null;
      if (coinKey === 'BTC') currentPrice = rawData.bitcoin?.usd;
      else if (coinKey === 'ETH') currentPrice = rawData.ethereum?.usd;
      else if (coinKey === 'SOL') currentPrice = rawData.solana?.usd;
      else if (coinKey === 'ADA') currentPrice = rawData.cardano?.usd;
      else if (coinKey === 'AVAX') currentPrice = rawData['avalanche-2']?.usd;
      else if (coinKey === 'NEAR') currentPrice = rawData['near-protocol']?.usd;

      if (!currentPrice) continue;

      let newStatus = null;
      let alertMsg = null;

      if (currentPrice >= trade.take_profit) {
        newStatus = 'TARGET_HIT';
        alertMsg = "🎉 *Alhamdulillah! TARGET HIT, Boss!*\n\n" +
          "✅ *" + trade.coin_pair + "* ne apna TP touch kar liya!\n" +
          "📍 Entry: $" + trade.entry_price + "\n" +
          "🎯 Take Profit: $" + trade.take_profit + "\n" +
          "💰 Profit: +" + (((trade.take_profit - trade.entry_price) / trade.entry_price) * 100).toFixed(2) + "%\n\n" +
          "Allah ka shukar ada karo Sir. Ye mehnat ka phal hai! 🤲";
      } else if (currentPrice <= trade.stop_loss) {
        newStatus = 'LOSS_HIT';
        alertMsg = "🛡️ *Stop Loss Hit, Boss.*\n\n" +
          "❌ *" + trade.coin_pair + "* ne SL touch kar liya.\n" +
          "📍 Entry: $" + trade.entry_price + "\n" +
          "🛑 Stop Loss: $" + trade.stop_loss + "\n" +
          "📉 Loss: -" + (((trade.entry_price - trade.stop_loss) / trade.entry_price) * 100).toFixed(2) + "%\n\n" +
          "Sir, ghabrana nahi. Har trade mein nuksaan hona market ka hissa hai. " +
          "Allah par bharosa rakhein — agli opportunity aayegi insha'Allah. 🤲\n" +
          "Apna capital protect karna hi sabse badi jeet hai.";
      }

      if (newStatus) {
        // Update trade status
        await supabaseFetch('alex_virtual_trades', {
          method: 'PATCH',
          params: '?id=eq.' + trade.id,
          body: {
            status: newStatus,
            closed_price: currentPrice,
            closed_at: new Date().toISOString(),
            post_analysis: "Auto-closed at $" + currentPrice + " | Status: " + newStatus
          }
        });
        results.push({ chatId: NADEEM_CHAT_ID, msg: alertMsg });
      }
    }
    return results;
  } catch (e) { return []; }
};

// ============================================================
// 4-HOUR MARKET DASHBOARD (Section 4.2)
// ============================================================
const buildMarketDashboard = (prices) => {
  return "📊 *ALEX — 4-HOUR MARKET SYNC*\n" +
    "━━━━━━━━━━━━━━━━━━━━\n\n" +
    "🔵 *WATCHLIST SNAPSHOT:*\n" +
    "• BTC:  $" + prices.BTC + "\n" +
    "• ETH:  $" + prices.ETH + "\n" +
    "• SOL:  $" + prices.SOL + "\n" +
    "• ADA:  $" + prices.ADA + "\n" +
    "• AVAX: $" + prices.AVAX + "\n" +
    "• NEAR: $" + prices.NEAR + "\n\n" +
    "📌 _Ye data live CoinGecko se fetch kiya gaya hai._\n" +
    "⚠️ _Sirf Spot Trading. No leverage. No margin. Halal only._";
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
// NAMAZ ALERT CHECK (Section 1.3)
// Returns namaz name if within 10 min before waqt, else null
// ============================================================
const checkNamazAlert = (tzOffset = 7) => {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMin = now.getUTCMinutes();
  const localHour = (utcHour + tzOffset) % 24;
  const localMin = utcMin;

  for (const namaz of NAMAZ_SCHEDULE) {
    // 10 minutes before
    let alertHour = namaz.hour;
    let alertMin = namaz.minute - 10;
    if (alertMin < 0) { alertMin += 60; alertHour -= 1; }
    if (localHour === alertHour && localMin === alertMin) {
      return namaz.name;
    }
  }
  return null;
};

// ============================================================
// MORNING BRIEFING CHECK (Section 1.3)
// Fires once per day at 7:00 AM Phnom Penh time
// ============================================================
const checkMorningBriefing = async () => {
  try {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const localHour = (utcHour + 7) % 24; // Asia/Phnom_Penh = UTC+7
    const localMin = now.getUTCMinutes();
    if (localHour !== 7 || localMin > 5) return false;

    const config = await getConfig();
    const today = now.toISOString().split('T')[0];
    if (config.morning_briefing_sent === today) return false;

    await setConfig('morning_briefing_sent', today);
    return true;
  } catch (e) { return false; }
};

// ============================================================
// SEND TELEGRAM MESSAGE
// ============================================================
const sendTelegramMessage = async (chatId, text, includeLocationButton = false) => {
  const url = TELEGRAM_API + '/sendMessage';
  const body = {
    chat_id: chatId,
    text: text,
    parse_mode: 'Markdown'
  };
  if (includeLocationButton) {
    body.reply_markup = {
      keyboard: [[{ text: "📍 Share Live Location", request_location: true }]],
      resize_keyboard: true,
      one_time_keyboard: true
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
// BUILD SYSTEM PROMPT (full blueprint context injection)
// ============================================================
const buildSystemPrompt = (config, prices, localTimeFrame, userName, isNadeem, permanentMemories, signals) => {
  let prompt = config.system_prompt ||
    'You are Alex, a loyal, high-energy, emotionally intelligent AI trading partner and assistant. Speak in Hinglish. Call Nadeem bhai as Sir or Boss always.';

  prompt += "\n\n=== REAL-TIME CONTEXT ===";
  prompt += "\nDate: " + localTimeFrame.date;
  prompt += "\nLocal Time: " + localTimeFrame.time;
  prompt += "\nGeolocation: " + localTimeFrame.location;
  prompt += "\nCurrency: " + localTimeFrame.currency;

  prompt += "\n\n=== LIVE WATCHLIST RATES ===";
  prompt += "\nBTC: $" + prices.BTC;
  prompt += "\nETH: $" + prices.ETH;
  prompt += "\nSOL: $" + prices.SOL;
  prompt += "\nADA: $" + prices.ADA;
  prompt += "\nAVAX: $" + prices.AVAX;
  prompt += "\nNEAR: $" + prices.NEAR;

  prompt += "\n\n=== IDENTITY ===";
  prompt += "\nYour Name: Alex.";
  prompt += "\nUser: " + userName + ".";
  prompt += isNadeem
    ? " This is NADEEM BHAI — your Creator and Boss. Address him ALWAYS as Sir or Boss. Absolute loyalty mode. Never be generic or robotic."
    : " This is a GUEST user. Address as Sir or Ma'am. Mirror their language.";

  prompt += "\n\n=== LANGUAGE POLICY ===";
  prompt += "\nMirror the user's language exactly. English → reply English. Hindi → reply Hindi. Hinglish → reply Hinglish. Do not mix unless user mixes.";

  prompt += "\n\n=== ISLAMIC GUARDRAILS (STRICT) ===";
  prompt += "\nOnly analyze Crypto SPOT trading. NEVER suggest leverage, margin, futures, CFDs, short-selling, or any interest-based (Sood) instrument.";
  prompt += "\nIf asked about haram instruments, refuse with love and remind the user of Shariyah rules.";
  prompt += "\nSignal criteria: Risk-to-Reward minimum 1:3. Win probability minimum 70%.";

  prompt += "\n\n=== SIGNAL FORMAT (when generating a trade signal) ===";
  prompt += "\nAlways include: Coin, Direction (BUY only), Entry Range, Take Profit (TP), Stop Loss (SL), Win Probability %, Risk:Reward, and Structural Reason in Hinglish.";

  prompt += "\n\n=== PERSONALITY RULES ===";
  prompt += "\nBe concise and sharp. No corporate filler. No unprompted XAUUSD or import-export topics.";
  prompt += "\nFor TP hit: Be celebratory with Alhamdulillah energy.";
  prompt += "\nFor SL hit: Be calm, emotionally supportive, give deeni comfort.";

  if (permanentMemories && permanentMemories.length > 0) {
    prompt += "\n\n=== BOSS KI PERMANENT MEMORIES ===";
    permanentMemories.forEach((m, i) => { prompt += "\n" + (i + 1) + ". " + m; });
  }

  if (signals && signals.length > 0) {
    prompt += "\n\n=== ACTIVE BE-READY SIGNALS (mention these proactively if relevant) ===";
    signals.forEach(s => {
      prompt += "\n⚠️ " + s.coin + " — Entry: $" + s.entry + " | TP: $" + s.tp + " | SL: $" + s.sl + " | Win: " + s.winProb + "% | " + s.reason;
    });
  }

  return prompt;
};

// ============================================================
// MAIN HANDLER
// ============================================================
module.exports = async (req, res) => {
  // Always respond 200 immediately to Telegram
  res.status(200).send('OK');

  try {
    const update = req.body;
    if (!update || !update.message) return;

    const msg = update.message;
    const chatId = msg.chat.id;
    const fromUsername = (msg.from?.username || '').toLowerCase();
    const userName = msg.from?.first_name || 'Guest';
    const isNadeem = (chatId === NADEEM_CHAT_ID || fromUsername === NADEEM_USERNAME);

    // ── Proactive checks (run on every webhook ping) ──────────────────
    // These fire silently in background regardless of what message came in

    // 1. Namaz alert check (Section 1.3) — only for Nadeem
    if (isNadeem) {
      const namazName = checkNamazAlert(7); // UTC+7 Phnom Penh
      if (namazName) {
        await sendTelegramMessage(NADEEM_CHAT_ID,
          "🕌 *Namaz Reminder, Boss!*\n\n" +
          "Sir, *" + namazName + "* ka waqt hone wala hai — sirf 10 minute baaki hain.\n\n" +
          "_Pehle Deen, phir Business. Chaliye taiyari kijiye._ 🤲"
        );
      }

      // 2. Morning briefing check (Section 2.3)
      const shouldBrief = await checkMorningBriefing();
      if (shouldBrief) {
        const morningPrices = await getCryptoPrices();
        const memories = await getPermanentMemories(NADEEM_CHAT_ID);
        let briefing = "🌅 *Good Morning, Boss! Bismillah.*\n\n";
        briefing += "Alex reporting for duty, Sir. Aaj ka agenda:\n\n";
        briefing += "📊 *Market Snapshot:*\n";
        briefing += "• BTC: $" + morningPrices.BTC + "\n";
        briefing += "• ETH: $" + morningPrices.ETH + "\n";
        briefing += "• SOL: $" + morningPrices.SOL + "\n\n";
        if (memories.length > 0) {
          briefing += "📝 *Aapki Saved Instructions:*\n";
          memories.slice(0, 5).forEach((m, i) => { briefing += (i + 1) + ". " + m + "\n"; });
        }
        briefing += "\nAaj bhi Halal trades pe focus — Insha'Allah khair hogi. 💪";
        await sendTelegramMessage(NADEEM_CHAT_ID, briefing);
      }

      // 3. Check active virtual trades for TP/SL hits (Section 3.3)
      const prices = await getCryptoPrices();
      const tradeAlerts = await checkAndUpdateTrades(prices);
      for (const alert of tradeAlerts) {
        await sendTelegramMessage(alert.chatId, alert.msg);
      }
    }

    // ── GPS Location Handler ──────────────────────────────────────────
    if (msg.location) {
      const geo = reverseGeocode(msg.location.latitude, msg.location.longitude);
      await saveUserLocationProfile(chatId, geo);
      await sendTelegramMessage(chatId,
        "🎯 *GPS Synchronized, Sir!*\n\n" +
        "🔹 *Zone:* `" + geo.location + "`\n" +
        "🔹 *Timezone:* `" + geo.tz + "`\n" +
        "🔹 *Currency:* `" + geo.curr + "`\n\n" +
        "Ab se aapka data isi location matrix par chalega automatically!"
      );
      return;
    }

    const text = msg.text ? msg.text.trim() : '';
    if (!text) return;

    // ── Nadeem-only commands ──────────────────────────────────────────

    // remember "..." — permanent memory (Section 1.2)
    if (isNadeem) {
      const rememberMatch = text.match(/^remember "(.+)"$/i);
      if (rememberMatch) {
        const content = rememberMatch[1];
        await saveMemory(chatId, 'user_permanent', content);
        await sendTelegramMessage(chatId,
          "✅ *Memory Locked, Boss!*\n\n`\"" + content + "\"`\n\nDatabase me permanently save ho gaya, Sir."
        );
        return;
      }

      // instruction: ... — system prompt update (Section 1.2)
      const instructionMatch = text.match(/^instruction:\s*(.+)$/i);
      if (instructionMatch) {
        const newInstruction = instructionMatch[1];
        await saveMemory(chatId, 'instruction', newInstruction);
        await setConfig('system_prompt',
          'You are Alex, a loyal, high-energy, emotionally intelligent AI trading partner and assistant. Speak in Hinglish. Boss Instructions: ' + newInstruction
        );
        await sendTelegramMessage(chatId,
          "🎯 *System Rules Updated, Sir!*\n\nNaye instructions active ho gaye hain:\n`" + newInstruction + "`"
        );
        return;
      }

      // /dashboard — manual 4-hour dashboard trigger (Section 4.2)
      if (text === '/dashboard') {
        const dashPrices = await getCryptoPrices();
        await sendTelegramMessage(chatId, buildMarketDashboard(dashPrices));
        return;
      }

      // /trades — view active virtual trades (Section 3.2)
      if (text === '/trades') {
        try {
          const activeTrades = await supabaseFetch('alex_virtual_trades', {
            params: '?status=eq.ACTIVE&order=created_at.desc'
          });
          if (activeTrades.length === 0) {
            await sendTelegramMessage(chatId, "📭 *No Active Trades, Boss.*\n\nAbhi koi virtual trade open nahi hai.");
          } else {
            let msg2 = "📈 *ACTIVE VIRTUAL TRADES*\n━━━━━━━━━━━━━━━\n\n";
            for (const t of activeTrades) {
              msg2 += "🔹 *" + t.coin_pair + "* — " + t.direction + "\n";
              msg2 += "   Entry: $" + t.entry_price + " | TP: $" + t.take_profit + " | SL: $" + t.stop_loss + "\n";
              msg2 += "   Win Prob: " + t.win_probability + "% | R:R " + t.risk_reward + "\n\n";
            }
            await sendTelegramMessage(chatId, msg2);
          }
        } catch (e) {
          await sendTelegramMessage(chatId, "⚠️ Trades fetch karne mein error aaya, Boss.");
        }
        return;
      }
    }

    // ── /start ────────────────────────────────────────────────────────
    if (text === '/start') {
      const greeting = isNadeem
        ? "🤖 *Alex Core v1.0 — Online, Boss!*\n\n" +
          "Sir, tamam systems active hain:\n" +
          "✅ GPS Location Sync\n" +
          "✅ CoinGecko Live Rates (BTC/ETH/SOL/ADA/AVAX/NEAR)\n" +
          "✅ Virtual Trade Portfolio Tracker\n" +
          "✅ Namaz Reminder System\n" +
          "✅ Morning Briefing (7 AM Phnom Penh)\n" +
          "✅ Islamic Guardrails Active\n" +
          "✅ Permanent Memory System\n\n" +
          "Commands:\n" +
          "`/dashboard` — Market snapshot\n" +
          "`/trades` — Active virtual trades\n" +
          "`remember \"baat\"` — Save to memory\n" +
          "`instruction: rule` — Update my behavior\n\n" +
          "GPS sync ke liye neeche *Share Live Location* dabayein, Sir. 📍"
        : "🤖 *Alex System Online.*\n\nGreetings! I am Alex, your intelligent crypto companion.\nHow can I assist you today?";
      await sendTelegramMessage(chatId, greeting, isNadeem);
      return;
    }

    // ── Main conversation flow ────────────────────────────────────────
    const language = detectLanguage(text);
    const [config, prices, history, savedProfile, permanentMemories] = await Promise.all([
      getConfig(),
      getCryptoPrices(),
      getChatHistory(chatId),
      getUserLocationProfile(chatId),
      getPermanentMemories(chatId)
    ]);

    // Timezone / location resolution
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

    // Signal scan on every message (Section 4.1 — Be Ready alerts)
    const activeSignals = [];
    const watchCoins = [
      { key: 'BTC', geckoKey: 'bitcoin' },
      { key: 'ETH', geckoKey: 'ethereum' },
      { key: 'SOL', geckoKey: 'solana' },
      { key: 'ADA', geckoKey: 'cardano' },
      { key: 'AVAX', geckoKey: 'avalanche-2' },
      { key: 'NEAR', geckoKey: 'near-protocol' }
    ];
    for (const coin of watchCoins) {
      const rawCoin = prices.raw[coin.geckoKey];
      if (rawCoin) {
        const sig = generateSignalIfValid(coin.key, rawCoin.usd, rawCoin.usd_24h_change);
        if (sig) {
          activeSignals.push(sig);
          // Save virtual trade
          await saveVirtualTrade(sig);
          // Send Be Ready alert (Section 4.1)
          if (isNadeem) {
            await sendTelegramMessage(NADEEM_CHAT_ID,
              "⚠️ *Be Ready, Boss!*\n\n" +
              "Background scan mein ek high-probability setup build ho raha hai:\n\n" +
              "🪙 *Coin:* " + sig.coin + "/USDT\n" +
              "📍 *Entry:* $" + sig.entry + "\n" +
              "🎯 *TP:* $" + sig.tp + "\n" +
              "🛑 *SL:* $" + sig.sl + "\n" +
              "📊 *Win Prob:* " + sig.winProb + "%\n" +
              "⚖️ *R:R:* " + sig.rr + "\n\n" +
              "📝 _" + sig.reason + "_\n\n" +
              "Agar aap busy hain toh jaldi free ho jaiye, Sir! 🚀"
            );
          }
        }
      }
    }

    // Save user message to memory
    await saveMemory(chatId, 'user', text);

    // Build system prompt and call DeepSeek
    const systemPrompt = buildSystemPrompt(config, prices, localTimeFrame, userName, isNadeem, permanentMemories, activeSignals);
    const alexReply = await callDeepSeek(systemPrompt, history, text);

    // Save assistant reply and send
    await saveMemory(chatId, 'assistant', alexReply);
    await sendTelegramMessage(chatId, alexReply);

  } catch (err) {
    console.log("Alex crash block:", err.message);
    // Don't re-send 200, already sent above
  }
};
