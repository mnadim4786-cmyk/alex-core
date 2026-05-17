// api/cron.js — ALEX CORE v1.1 — Reliable Proactive Alert Engine
// Runs every minute via cron-job.org
// NO Supabase dependency for time checks — 100% reliable

const BOT_TOKEN   = process.env.BOT_TOKEN;
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

const TELEGRAM_API  = "https://api.telegram.org/bot" + BOT_TOKEN;
const DEEPSEEK_API  = "https://api.deepseek.com/v1/chat/completions";
const NADEEM_CHAT_ID = 1123787650;

// Phnom Penh = UTC+7
const PP_OFFSET_HOURS = 7;

// Namaz schedule Phnom Penh (approximate)
const NAMAZ_SCHEDULE = [
  { name: "Fajr",    hour: 4,  minute: 30 },
  { name: "Dhuhr",   hour: 12, minute: 15 },
  { name: "Asr",     hour: 15, minute: 30 },
  { name: "Maghrib", hour: 18, minute: 15 },
  { name: "Isha",    hour: 19, minute: 30 }
];

// Dashboard fire times (Phnom Penh local hour)
const DASHBOARD_HOURS = [8, 12, 16, 20];

// ============================================================
// GET PHNOM PENH TIME — Always calculated from UTC
// ============================================================
const getPPTime = () => {
  const nowUTC = new Date();
  // Add PP offset
  const ppMs = nowUTC.getTime() + (PP_OFFSET_HOURS * 60 * 60 * 1000);
  const pp = new Date(ppMs);
  return {
    hour:    pp.getUTCHours(),
    minute:  pp.getUTCMinutes(),
    dateStr: pp.getUTCFullYear() + '-' +
             String(pp.getUTCMonth() + 1).padStart(2, '0') + '-' +
             String(pp.getUTCDate()).padStart(2, '0'),
    display: pp.toUTCString().replace('GMT', 'PPH (+7)')
  };
};

// ============================================================
// HELPERS
// ============================================================
const fetchWT = async (url, options = {}, timeout = 20000) => {
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
    const res = await fetchWT(TELEGRAM_API + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: NADEEM_CHAT_ID,
        text: text,
        parse_mode: 'Markdown'
      })
    });
    return res.ok;
  } catch (e) {
    console.log("Telegram error:", e.message);
    return false;
  }
};

// ============================================================
// SUPABASE — Only for trade checks (not for time logic)
// ============================================================
const supabaseFetch = async (table, options = {}) => {
  const { method = 'GET', body, params = '' } = options;
  const url = SUPABASE_URL + '/rest/v1/' + table + params;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
  const res = await fetchWT(url, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined
  }, 10000);
  if (!res.ok) throw new Error("Supabase " + res.status);
  return res.json();
};

// ============================================================
// CRYPTO PRICES
// ============================================================
const getCryptoPrices = async () => {
  try {
    const res = await fetchWT(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,cardano,avalanche-2,near-protocol&vs_currencies=usd&include_24hr_change=true',
      {}, 10000
    );
    if (!res.ok) throw new Error("CoinGecko " + res.status);
    const d = await res.json();
    const fmt = (n) => n ? '$' + parseFloat(n).toLocaleString('en-US', { minimumFractionDigits: 2 }) : 'N/A';
    const chg = (n) => {
      if (!n) return '';
      const num = parseFloat(n);
      return num > 0 ? ' 📈 +' + num.toFixed(2) + '%' : ' 📉 ' + num.toFixed(2) + '%';
    };
    return {
      BTC:  fmt(d.bitcoin?.usd)          + chg(d.bitcoin?.usd_24h_change),
      ETH:  fmt(d.ethereum?.usd)         + chg(d.ethereum?.usd_24h_change),
      SOL:  fmt(d.solana?.usd)           + chg(d.solana?.usd_24h_change),
      ADA:  fmt(d.cardano?.usd)          + chg(d.cardano?.usd_24h_change),
      AVAX: fmt(d['avalanche-2']?.usd)   + chg(d['avalanche-2']?.usd_24h_change),
      NEAR: fmt(d['near-protocol']?.usd) + chg(d['near-protocol']?.usd_24h_change),
      raw: d
    };
  } catch (e) {
    console.log("CoinGecko error:", e.message);
    return { BTC: 'Offline', ETH: 'Offline', SOL: 'Offline', ADA: 'Offline', AVAX: 'Offline', NEAR: 'Offline', raw: {} };
  }
};

// ============================================================
// NEWS SUMMARY via DeepSeek
// ============================================================
const getNewsSummary = async () => {
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
            content: 'You are a sharp crypto and world news analyst. Give 4-5 bullet points of major world and crypto news right now. Hinglish me. Each point max 1 line. No preamble.'
          },
          {
            role: 'user',
            content: 'Latest world + crypto news summary abhi ke liye.'
          }
        ],
        temperature: 0.5,
        max_tokens: 400
      })
    }, 15000);
    const data = await res.json();
    if (!res.ok) return "📡 News fetch nahi ho saki.";
    return data.choices[0].message.content;
  } catch (e) {
    return "📡 News fetch nahi ho saki.";
  }
};

// ============================================================
// DUPLICATE ALERT PREVENTION — Simple Supabase flag
// Only used for sent-today tracking, NOT for time logic
// If Supabase fails, we still send (better duplicate than no alert)
// ============================================================
const wasAlertSentToday = async (key) => {
  try {
    const rows = await supabaseFetch('alex_config', {
      params: '?key=eq.' + key
    });
    return rows && rows.length > 0 && rows[0].value === 'true';
  } catch (e) {
    // If Supabase fails, assume NOT sent — better to send duplicate than miss
    return false;
  }
};

const markAlertSent = async (key) => {
  try {
    await supabaseFetch('alex_config', {
      method: 'POST',
      params: '?on_conflict=key',
      body: { key: key, value: 'true' }
    });
  } catch (e) {
    // Non-critical — ignore
  }
};

// ============================================================
// 1. MORNING BRIEFING — 7:00 AM Phnom Penh
// ============================================================
const handleMorning = async (pp, prices) => {
  if (pp.hour !== 7 || pp.minute !== 0) return;

  const key = 'morning_' + pp.dateStr;
  if (await wasAlertSentToday(key)) return;

  const news = await getNewsSummary();

  const msg =
    "🌅 *Assalamualaikum Boss! Good Morning!*\n" +
    "_" + pp.display + "_\n\n" +
    "Alex reporting for duty. Bismillah — aaj ka din mubarak ho! 🤲\n\n" +
    "📊 *Market Snapshot:*\n" +
    "• BTC:  " + prices.BTC + "\n" +
    "• ETH:  " + prices.ETH + "\n" +
    "• SOL:  " + prices.SOL + "\n" +
    "• ADA:  " + prices.ADA + "\n" +
    "• AVAX: " + prices.AVAX + "\n" +
    "• NEAR: " + prices.NEAR + "\n\n" +
    "🌍 *News Snapshot:*\n" + news + "\n\n" +
    "💪 Aaj bhi Halal trades pe focus — Insha'Allah khair hogi!";

  const sent = await sendTelegram(msg);
  if (sent) await markAlertSent(key);
};

// ============================================================
// 2. NAMAZ ALERTS — 10 min before each namaz
// ============================================================
const handleNamaz = async (pp) => {
  for (const namaz of NAMAZ_SCHEDULE) {
    let alertHour = namaz.hour;
    let alertMin  = namaz.minute - 10;
    if (alertMin < 0) { alertMin += 60; alertHour -= 1; }
    if (alertHour < 0) alertHour += 24;

    if (pp.hour !== alertHour || pp.minute !== alertMin) continue;

    const key = 'namaz_' + namaz.name + '_' + pp.dateStr;
    if (await wasAlertSentToday(key)) continue;

    const sent = await sendTelegram(
      "🕌 *" + namaz.name + " Namaz, Boss!*\n\n" +
      "Sir, sirf *10 minute* baaki hain.\n" +
      "_Pehle Deen, phir Business._\n\n" +
      "Chaliye wudu karein aur taiyari karein. 🤲"
    );
    if (sent) await markAlertSent(key);
  }
};

// ============================================================
// 3. 4-HOUR MARKET DASHBOARD
// ============================================================
const handleDashboard = async (pp, prices) => {
  if (!DASHBOARD_HOURS.includes(pp.hour) || pp.minute !== 0) return;

  const key = 'dashboard_' + pp.dateStr + '_' + pp.hour;
  if (await wasAlertSentToday(key)) return;

  const news = await getNewsSummary();

  const msg =
    "📊 *ALEX — " + pp.hour + ":00 MARKET SYNC*\n" +
    "━━━━━━━━━━━━━━━━━━━━\n" +
    "_" + pp.display + "_\n\n" +
    "🔵 *Watchlist:*\n" +
    "• BTC:  " + prices.BTC + "\n" +
    "• ETH:  " + prices.ETH + "\n" +
    "• SOL:  " + prices.SOL + "\n" +
    "• ADA:  " + prices.ADA + "\n" +
    "• AVAX: " + prices.AVAX + "\n" +
    "• NEAR: " + prices.NEAR + "\n\n" +
    "🌍 *Global News:*\n" + news + "\n\n" +
    "⚠️ _Sirf Spot Trading. No leverage. Halal only._";

  const sent = await sendTelegram(msg);
  if (sent) await markAlertSent(key);
};

// ============================================================
// 4. TRADE TP/SL CHECKER
// ============================================================
const handleTrades = async (prices) => {
  try {
    const trades = await supabaseFetch('alex_virtual_trades', {
      params: '?status=eq.ACTIVE'
    });

    for (const trade of trades) {
      const coinKey = trade.coin_pair.replace('/USDT', '');
      const raw = prices.raw;
      let cp = null;
      if (coinKey === 'BTC')  cp = raw.bitcoin?.usd;
      if (coinKey === 'ETH')  cp = raw.ethereum?.usd;
      if (coinKey === 'SOL')  cp = raw.solana?.usd;
      if (coinKey === 'ADA')  cp = raw.cardano?.usd;
      if (coinKey === 'AVAX') cp = raw['avalanche-2']?.usd;
      if (coinKey === 'NEAR') cp = raw['near-protocol']?.usd;
      if (!cp) continue;

      let newStatus = null;
      let alertMsg  = null;

      if (cp >= trade.take_profit) {
        newStatus = 'TARGET_HIT';
        alertMsg =
          "🎉 *Alhamdulillah! TARGET HIT Boss!*\n\n" +
          "✅ *" + trade.coin_pair + "* TP touch!\n" +
          "📍 Entry: $" + trade.entry_price + "\n" +
          "🎯 TP: $" + trade.take_profit + "\n" +
          "💰 Profit: +" + (((trade.take_profit - trade.entry_price) / trade.entry_price) * 100).toFixed(2) + "%\n\n" +
          "Allah ka shukar Sir! 🤲";
      } else if (cp <= trade.stop_loss) {
        newStatus = 'LOSS_HIT';
        alertMsg =
          "🛡️ *Stop Loss Hit Boss.*\n\n" +
          "❌ *" + trade.coin_pair + "* SL touch.\n" +
          "📍 Entry: $" + trade.entry_price + "\n" +
          "🛑 SL: $" + trade.stop_loss + "\n" +
          "📉 Loss: -" + (((trade.entry_price - trade.stop_loss) / trade.entry_price) * 100).toFixed(2) + "%\n\n" +
          "Ghabrana nahi Sir. Capital safe — agli opportunity aayegi Insha'Allah. 🤲";
      }

      if (newStatus) {
        await supabaseFetch('alex_virtual_trades', {
          method: 'PATCH',
          params: '?id=eq.' + trade.id,
          body: {
            status: newStatus,
            closed_price: cp,
            closed_at: new Date().toISOString()
          }
        });
        await sendTelegram(alertMsg);
      }
    }
  } catch (e) {
    console.log("Trade check error:", e.message);
  }
};

// ============================================================
// MAIN HANDLER
// ============================================================
module.exports = async (req, res) => {
  // Respond immediately so cron-job.org doesn't timeout
  res.status(200).json({ status: 'OK', time: new Date().toISOString() });

  try {
    // Always calculate PP time fresh from UTC
    const pp = getPPTime();
    console.log("Cron running — PP Time:", pp.display, "| Hour:", pp.hour, "| Min:", pp.minute);

    // Get prices once — used by multiple handlers
    const prices = await getCryptoPrices();
    console.log("Prices fetched — BTC:", prices.BTC);

    // Run all checks
    await handleMorning(pp, prices);
    await handleNamaz(pp);
    await handleDashboard(pp, prices);
    await handleTrades(prices);

  } catch (err) {
    console.log("Cron crash:", err.message);
  }
};
