// api/cron.js — ALEX CORE v1.0 — Proactive Alert Engine
// Runs every minute via Vercel Cron
// Handles: Namaz alerts, Morning briefing, 4-hour dashboard, Trade TP/SL, Be Ready signals, News

const BOT_TOKEN    = process.env.BOT_TOKEN;
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

const TELEGRAM_API = "https://api.telegram.org/bot" + BOT_TOKEN;
const DEEPSEEK_API = "https://api.deepseek.com/v1/chat/completions";
const NADEEM_CHAT_ID = 1123787650;

// Phnom Penh UTC+7
const PP_OFFSET = 7;

// Namaz schedule for Phnom Penh (approximate)
const NAMAZ_SCHEDULE = [
  { name: "Fajr",    hour: 4,  minute: 30 },
  { name: "Dhuhr",   hour: 12, minute: 15 },
  { name: "Asr",     hour: 15, minute: 30 },
  { name: "Maghrib", hour: 18, minute: 15 },
  { name: "Isha",    hour: 19, minute: 30 }
];

// ============================================================
// HELPERS
// ============================================================
const fetchWithTimeout = async (url, options = {}, timeout = 20000) => {
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
    method, headers,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error("Supabase error: " + res.status);
  return res.json();
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

const getConfig = async () => {
  try {
    const rows = await supabaseFetch('alex_config');
    const config = {};
    for (const row of rows) config[row.key] = row.value;
    return config;
  } catch (e) { return {}; }
};

const sendTelegram = async (chatId, text) => {
  try {
    await fetchWithTimeout(TELEGRAM_API + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
    });
  } catch (e) {}
};

// Get Phnom Penh local time info
const getPPTime = () => {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const ppMs = utcMs + PP_OFFSET * 3600000;
  const pp = new Date(ppMs);
  return {
    hour: pp.getHours(),
    minute: pp.getMinutes(),
    dateStr: pp.toISOString().split('T')[0],  // YYYY-MM-DD
    pp
  };
};

// ============================================================
// CRYPTO PRICES — CoinGecko
// ============================================================
const getCryptoPrices = async () => {
  try {
    const res = await fetchWithTimeout(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,cardano,avalanche-2,near-protocol&vs_currencies=usd&include_24hr_change=true'
    );
    if (!res.ok) throw new Error("CoinGecko error");
    const d = await res.json();
    const fmt = (n) => n ? parseFloat(n).toLocaleString('en-US', { minimumFractionDigits: 2 }) : "N/A";
    const chg = (n) => n ? (n > 0 ? "📈 +" : "📉 ") + parseFloat(n).toFixed(2) + "%" : "";
    return {
      BTC:  fmt(d.bitcoin?.usd)          + " " + chg(d.bitcoin?.usd_24h_change),
      ETH:  fmt(d.ethereum?.usd)         + " " + chg(d.ethereum?.usd_24h_change),
      SOL:  fmt(d.solana?.usd)           + " " + chg(d.solana?.usd_24h_change),
      ADA:  fmt(d.cardano?.usd)          + " " + chg(d.cardano?.usd_24h_change),
      AVAX: fmt(d['avalanche-2']?.usd)   + " " + chg(d['avalanche-2']?.usd_24h_change),
      NEAR: fmt(d['near-protocol']?.usd) + " " + chg(d['near-protocol']?.usd_24h_change),
      raw: d
    };
  } catch (e) {
    return { BTC: "Offline", ETH: "Offline", SOL: "Offline", ADA: "Offline", AVAX: "Offline", NEAR: "Offline", raw: {} };
  }
};

// ============================================================
// DEEPSEEK — News Summary Generator
// ============================================================
const getNewsSummary = async () => {
  try {
    const body = {
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: 'You are Alex, a sharp crypto and world news analyst. Give a brief 5-6 bullet point summary of major world and crypto news right now. Format in Hinglish. Keep each point under 1 line. Focus on geopolitical events and crypto market movers.'
        },
        {
          role: 'user',
          content: 'Give me the latest world news and crypto news summary for my morning briefing. Be concise and sharp.'
        }
      ],
      temperature: 0.5,
      max_tokens: 500
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
    if (!res.ok) return "News fetch nahi ho saki abhi.";
    return data.choices[0].message.content;
  } catch (e) { return "News fetch nahi ho saki abhi."; }
};

// ============================================================
// SIGNAL ENGINE — Be Ready Alert
// ============================================================
const generateSignalIfValid = (coin, price, change24h) => {
  if (!price || !change24h) return null;
  const chgNum = parseFloat(change24h);
  const priceNum = parseFloat(price);
  if (isNaN(chgNum) || isNaN(priceNum)) return null;
  if (chgNum < -5 && chgNum > -20) {
    const entry = priceNum;
    const sl = parseFloat((entry * 0.97).toFixed(4));
    const tp = parseFloat((entry * 1.09).toFixed(4));
    const winProb = Math.min(95, Math.round(70 + Math.abs(chgNum) * 1.2));
    if (winProb >= 70) {
      return { coin, entry, sl, tp, rr: "1:3", winProb, reason: coin + " ne 24h me " + chgNum.toFixed(2) + "% ki girawat li. Oversold bounce setup." };
    }
  }
  return null;
};

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
// TRADE TP/SL CHECKER (Section 3.3)
// ============================================================
const checkActiveTrades = async (prices) => {
  try {
    const trades = await supabaseFetch('alex_virtual_trades', {
      params: '?status=eq.ACTIVE'
    });
    for (const trade of trades) {
      const coinKey = trade.coin_pair.replace('/USDT', '');
      const raw = prices.raw;
      let currentPrice = null;
      if (coinKey === 'BTC')  currentPrice = raw.bitcoin?.usd;
      if (coinKey === 'ETH')  currentPrice = raw.ethereum?.usd;
      if (coinKey === 'SOL')  currentPrice = raw.solana?.usd;
      if (coinKey === 'ADA')  currentPrice = raw.cardano?.usd;
      if (coinKey === 'AVAX') currentPrice = raw['avalanche-2']?.usd;
      if (coinKey === 'NEAR') currentPrice = raw['near-protocol']?.usd;
      if (!currentPrice) continue;

      let newStatus = null;
      let alertMsg = null;

      if (currentPrice >= trade.take_profit) {
        newStatus = 'TARGET_HIT';
        alertMsg =
          "🎉 *Alhamdulillah! TARGET HIT, Boss!*\n\n" +
          "✅ *" + trade.coin_pair + "* TP touch kar liya!\n" +
          "📍 Entry: $" + trade.entry_price + "\n" +
          "🎯 TP: $" + trade.take_profit + "\n" +
          "💰 Profit: +" + (((trade.take_profit - trade.entry_price) / trade.entry_price) * 100).toFixed(2) + "%\n\n" +
          "Allah ka shukar ada karo Sir! 🤲";
      } else if (currentPrice <= trade.stop_loss) {
        newStatus = 'LOSS_HIT';
        alertMsg =
          "🛡️ *Stop Loss Hit, Boss.*\n\n" +
          "❌ *" + trade.coin_pair + "* SL touch kar liya.\n" +
          "📍 Entry: $" + trade.entry_price + "\n" +
          "🛑 SL: $" + trade.stop_loss + "\n" +
          "📉 Loss: -" + (((trade.entry_price - trade.stop_loss) / trade.entry_price) * 100).toFixed(2) + "%\n\n" +
          "Ghabrana nahi Sir. Capital safe hai — agli opportunity aayegi Insha'Allah. 🤲";
      }

      if (newStatus) {
        await supabaseFetch('alex_virtual_trades', {
          method: 'PATCH',
          params: '?id=eq.' + trade.id,
          body: {
            status: newStatus,
            closed_price: currentPrice,
            closed_at: new Date().toISOString(),
            post_analysis: "Auto-closed at $" + currentPrice + " | " + newStatus
          }
        });
        await sendTelegram(NADEEM_CHAT_ID, alertMsg);
      }
    }
  } catch (e) {}
};

// ============================================================
// 1. NAMAZ ALERT CHECK
// ============================================================
const handleNamazAlerts = async (config, ppTime) => {
  for (const namaz of NAMAZ_SCHEDULE) {
    let alertHour = namaz.hour;
    let alertMin = namaz.minute - 10;
    if (alertMin < 0) { alertMin += 60; alertHour -= 1; if (alertHour < 0) alertHour += 24; }

    if (ppTime.hour === alertHour && ppTime.minute === alertMin) {
      const sentKey = 'namaz_sent_' + namaz.name + '_' + ppTime.dateStr;
      if (config[sentKey]) return; // already sent today

      await sendTelegram(NADEEM_CHAT_ID,
        "🕌 *" + namaz.name + " ki Namaz, Boss!*\n\n" +
        "Sir, sirf *10 minute* baaki hain.\n\n" +
        "_Pehle Deen, phir Business._\n" +
        "Chaliye wudu karein aur taiyari karein. 🤲"
      );
      await setConfig(sentKey, 'true');
    }
  }
};

// ============================================================
// 2. MORNING BRIEFING — 7:00 AM Phnom Penh
// ============================================================
const handleMorningBriefing = async (config, ppTime, prices) => {
  if (ppTime.hour !== 7 || ppTime.minute !== 0) return;
  const sentKey = 'morning_sent_' + ppTime.dateStr;
  if (config[sentKey]) return;

  const news = await getNewsSummary();

  const msg =
    "🌅 *Assalamualaikum Boss! Good Morning!*\n\n" +
    "Alex reporting for duty, Sir. Bismillah — aaj ka din mubarak ho! 🤲\n\n" +
    "📊 *Market Snapshot:*\n" +
    "• BTC:  $" + prices.BTC + "\n" +
    "• ETH:  $" + prices.ETH + "\n" +
    "• SOL:  $" + prices.SOL + "\n" +
    "• ADA:  $" + prices.ADA + "\n" +
    "• AVAX: $" + prices.AVAX + "\n" +
    "• NEAR: $" + prices.NEAR + "\n\n" +
    "🌍 *World & Crypto News:*\n" + news + "\n\n" +
    "💪 Aaj bhi Halal trades pe focus — Insha'Allah khair hogi!";

  await sendTelegram(NADEEM_CHAT_ID, msg);
  await setConfig(sentKey, 'true');
};

// ============================================================
// 3. 4-HOUR MARKET DASHBOARD
// ============================================================
const handle4HourDashboard = async (config, ppTime, prices) => {
  // Fire at: 8AM, 12PM, 4PM, 8PM, 12AM Phnom Penh
  const dashboardHours = [8, 12, 16, 20, 0];
  if (!dashboardHours.includes(ppTime.hour) || ppTime.minute !== 0) return;

  const sentKey = 'dashboard_sent_' + ppTime.dateStr + '_' + ppTime.hour;
  if (config[sentKey]) return;

  const news = await getNewsSummary();

  const msg =
    "📊 *ALEX — " + ppTime.hour + ":00 MARKET SYNC*\n" +
    "━━━━━━━━━━━━━━━━━━━━\n\n" +
    "🔵 *Watchlist Snapshot:*\n" +
    "• BTC:  $" + prices.BTC + "\n" +
    "• ETH:  $" + prices.ETH + "\n" +
    "• SOL:  $" + prices.SOL + "\n" +
    "• ADA:  $" + prices.ADA + "\n" +
    "• AVAX: $" + prices.AVAX + "\n" +
    "• NEAR: $" + prices.NEAR + "\n\n" +
    "🌍 *Global News Snapshot:*\n" + news + "\n\n" +
    "⚠️ _Sirf Spot Trading. No leverage. Halal only._";

  await sendTelegram(NADEEM_CHAT_ID, msg);
  await setConfig(sentKey, 'true');
};

// ============================================================
// 4. BE READY SIGNAL ALERTS
// ============================================================
const handleBeReadyAlerts = async (config, ppTime, prices) => {
  // Check every 5 minutes only (minute % 5 === 0)
  if (ppTime.minute % 5 !== 0) return;

  const watchCoins = [
    { key: 'BTC',  geckoKey: 'bitcoin' },
    { key: 'ETH',  geckoKey: 'ethereum' },
    { key: 'SOL',  geckoKey: 'solana' },
    { key: 'ADA',  geckoKey: 'cardano' },
    { key: 'AVAX', geckoKey: 'avalanche-2' },
    { key: 'NEAR', geckoKey: 'near-protocol' }
  ];

  for (const coin of watchCoins) {
    const rawCoin = prices.raw[coin.geckoKey];
    if (!rawCoin) continue;

    const sig = generateSignalIfValid(coin.key, rawCoin.usd, rawCoin.usd_24h_change);
    if (!sig) continue;

    // Avoid duplicate alerts — check if already alerted for this coin today
    const sentKey = 'signal_sent_' + coin.key + '_' + ppTime.dateStr;
    if (config[sentKey]) continue;

    await saveVirtualTrade(sig);
    await sendTelegram(NADEEM_CHAT_ID,
      "⚠️ *Be Ready, Boss!*\n\n" +
      "Background scan mein high-probability setup detect hua:\n\n" +
      "🪙 *Coin:* " + sig.coin + "/USDT\n" +
      "📍 *Entry:* $" + sig.entry + "\n" +
      "🎯 *TP:* $" + sig.tp + "\n" +
      "🛑 *SL:* $" + sig.sl + "\n" +
      "📊 *Win Prob:* " + sig.winProb + "%\n" +
      "⚖️ *R:R:* " + sig.rr + "\n\n" +
      "📝 _" + sig.reason + "_\n\n" +
      "Jaldi free ho jaiye Sir — manually confirm karein! 🚀"
    );
    await setConfig(sentKey, 'true');
  }
};

// ============================================================
// MAIN CRON HANDLER
// ============================================================
module.exports = async (req, res) => {
  res.status(200).send('Cron OK');

  try {
    const ppTime = getPPTime();
    const [config, prices] = await Promise.all([
      getConfig(),
      getCryptoPrices()
    ]);

    // Run all checks in parallel
    await Promise.all([
      handleNamazAlerts(config, ppTime),
      handleMorningBriefing(config, ppTime, prices),
      handle4HourDashboard(config, ppTime, prices),
      handleBeReadyAlerts(config, ppTime, prices),
      checkActiveTrades(prices)
    ]);

  } catch (err) {
    console.log("Cron crash:", err.message);
  }
};
