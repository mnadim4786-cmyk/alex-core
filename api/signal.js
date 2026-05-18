// api/signal.js — ALEX CORE 2.0 — TradingView Signal Receiver
// Receives webhook from TradingView Pine Script
// Verifies with news + session filter
// Sends alert to Nadeem via Telegram

const BOT_TOKEN    = process.env.BOT_TOKEN;
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

const TELEGRAM_API   = "https://api.telegram.org/bot" + BOT_TOKEN;
const DEEPSEEK_API   = "https://api.deepseek.com/v1/chat/completions";
const NADEEM_CHAT_ID = 1123787650;
const PP_OFFSET      = 7;

// ============================================================
// HELPERS
// ============================================================
const fetchWT = async (url, options = {}, timeout = 15000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
};

const sendTelegram = async (text) => {
  try {
    await fetchWT(TELEGRAM_API + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: NADEEM_CHAT_ID,
        text,
        parse_mode: 'Markdown'
      })
    }, 10000);
  } catch (e) {
    console.log("Telegram error:", e.message);
  }
};

// ============================================================
// GET PHNOM PENH TIME
// ============================================================
const getPPTime = () => {
  const nowUTC = new Date();
  const ppMs = nowUTC.getTime() + (PP_OFFSET * 3600000);
  const pp = new Date(ppMs);
  return {
    hour: pp.getUTCHours(),
    display: String(pp.getUTCHours()).padStart(2,'0') + ':' +
             String(pp.getUTCMinutes()).padStart(2,'0') + ' PPH (+7)'
  };
};

// ============================================================
// SESSION CHECK
// ============================================================
const isActiveSession = (hour) => {
  // EU: 12PM-8PM, US: 8PM-2AM Phnom Penh
  return (hour >= 12 && hour < 20) || hour >= 20 || hour < 2;
};

// ============================================================
// GET CACHED NEWS
// ============================================================
const getCachedNews = async () => {
  try {
    const res = await fetchWT(
      SUPABASE_URL + '/rest/v1/alex_config?key=eq.cached_news',
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY
        }
      },
      8000
    );
    const rows = await res.json();
    return rows?.length > 0 ? rows[0].value : null;
  } catch (e) {
    return null;
  }
};

// ============================================================
// NEWS SENTIMENT CHECK via DeepSeek
// ============================================================
const checkNewsSentiment = async (coin, news) => {
  if (!news) return { safe: true, reason: "News unavailable — proceed with caution" };

  try {
    const res = await fetchWT(DEEPSEEK_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + DEEPSEEK_KEY
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: 'You are a crypto risk analyst. Answer in JSON only. No extra text.'
          },
          {
            role: 'user',
            content: 'Given this news:\n' + news + '\n\nIs it safe to enter a SPOT BUY trade on ' + coin + ' right now? Reply ONLY with JSON: {"safe": true/false, "reason": "one line explanation", "risk": "low/medium/high"}'
          }
        ],
        temperature: 0.3,
        max_tokens: 150
      })
    }, 12000);

    const data = await res.json();
    const text = data.choices[0].message.content;
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    return { safe: true, reason: "Sentiment check failed — proceed carefully", risk: "medium" };
  }
};

// ============================================================
// SAVE VIRTUAL TRADE
// ============================================================
const saveVirtualTrade = async (signal) => {
  try {
    await fetchWT(
      SUPABASE_URL + '/rest/v1/alex_virtual_trades',
      {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          coin_pair:         signal.coin + '/USDT',
          direction:         'BUY',
          entry_price:       signal.entry,
          take_profit_1:     signal.tp1,
          take_profit_2:     signal.tp2,
          take_profit_3:     signal.tp3,
          take_profit:       signal.tp3,
          stop_loss:         signal.sl,
          win_probability:   signal.winProb,
          risk_reward:       signal.rr,
          structural_reason: 'TradingView SMC Signal | Score: ' + signal.smc_score + '/4',
          status:            'ACTIVE',
          break_even_hit:    false
        })
      },
      10000
    );
    console.log("Virtual trade saved:", signal.coin);
  } catch (e) {
    console.log("Trade save error:", e.message);
  }
};

// ============================================================
// MAIN HANDLER
// ============================================================
module.exports = async (req, res) => {
  // Must be POST
  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'Alex Signal API — Ready' });
  }

  try {
    console.log("Signal received from TradingView");

    // Parse signal
    let signal;
    try {
      signal = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch (e) {
      console.log("Parse error:", e.message);
      return res.status(200).json({ status: 'error', message: 'Invalid JSON' });
    }

    console.log("Signal:", JSON.stringify(signal));

    // Validate required fields
    if (!signal.coin || !signal.entry || !signal.sl || !signal.tp1) {
      return res.status(200).json({ status: 'error', message: 'Missing fields' });
    }

    const pp = getPPTime();
    const sessionActive = isActiveSession(pp.hour);

    // Session check
    if (!sessionActive) {
      console.log("Signal rejected — Asian session (low volume)");
      return res.status(200).json({ status: 'rejected', reason: 'Asian session' });
    }

    // Get news and check sentiment
    const news = await getCachedNews();
    const sentiment = await checkNewsSentiment(signal.coin, news);

    console.log("Sentiment:", JSON.stringify(sentiment));

    // Build RR
    const rr = signal.rr || '1:2';
    const winProb = signal.winProb || 70;
    const smcScore = signal.smc_score || 0;

    // SMC details
    const smcDetails =
      (signal.ob       ? "✅ Order Block\n" : "❌ Order Block\n") +
      (signal.fvg      ? "✅ Fair Value Gap\n" : "❌ FVG\n") +
      (signal.liq_sweep ? "✅ Liquidity Sweep\n" : "❌ Liq Sweep\n") +
      (signal.bos      ? "✅ Break of Structure" : "❌ BOS");

    if (!sentiment.safe) {
      // News is negative — send warning but still alert
      await sendTelegram(
        "⚠️ *SIGNAL ALERT — NEWS CAUTION, Boss!*\n\n" +
        "🪙 *Coin:* " + signal.coin + "/USDT\n" +
        "📊 *Direction:* SPOT BUY\n" +
        "📍 *Entry:* $" + signal.entry + "\n\n" +
        "🎯 *TP1:* $" + signal.tp1 + " _(40% exit)_\n" +
        "🎯 *TP2:* $" + signal.tp2 + " _(40% exit)_\n" +
        "🎯 *TP3:* $" + signal.tp3 + " _(20% exit)_\n\n" +
        "🛑 *SL:* $" + signal.sl + "\n" +
        "📊 *Win Prob:* " + winProb + "%\n" +
        "⚖️ *R:R:* " + rr + "\n\n" +
        "📈 *SMC Analysis:*\n" + smcDetails + "\n\n" +
        "🌍 *News Risk:* " + (sentiment.risk || 'medium').toUpperCase() + "\n" +
        "⚠️ _" + sentiment.reason + "_\n\n" +
        "🕐 *Session:* " + pp.display + "\n\n" +
        "_News caution hai Sir — apni judgment use karein!_"
      );
    } else {
      // All clear — send full signal
      await sendTelegram(
        "⚡ *SIGNAL ALERT, Boss!*\n" +
        "━━━━━━━━━━━━━━━━━━━━\n\n" +
        "🪙 *Coin:* " + signal.coin + "/USDT\n" +
        "📊 *Direction:* SPOT BUY\n" +
        "📍 *Entry:* $" + signal.entry + "\n\n" +
        "🎯 *TP1:* $" + signal.tp1 + " _(40% exit)_\n" +
        "🎯 *TP2:* $" + signal.tp2 + " _(40% exit)_\n" +
        "🎯 *TP3:* $" + signal.tp3 + " _(20% exit)_\n\n" +
        "🛑 *SL:* $" + signal.sl + "\n" +
        "📊 *Win Prob:* " + winProb + "%\n" +
        "⚖️ *R:R:* " + rr + "\n\n" +
        "📈 *SMC Analysis:*\n" + smcDetails + "\n\n" +
        "✅ *News:* Clear — " + sentiment.reason + "\n" +
        "🕐 *Session:* " + pp.display + "\n\n" +
        "_Manually confirm karein Sir!_ 🚀"
      );

      // Save virtual trade
      await saveVirtualTrade({
        coin: signal.coin,
        entry: signal.entry,
        sl: signal.sl,
        tp1: signal.tp1,
        tp2: signal.tp2,
        tp3: signal.tp3,
        winProb,
        rr,
        smc_score: smcScore
      });
    }

    return res.status(200).json({ status: 'OK', coin: signal.coin });

  } catch (err) {
    console.log("Signal handler error:", err.message);
    return res.status(200).json({ status: 'error', error: err.message });
  }
};
