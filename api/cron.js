// api/cron.js — ALEX CORE v1.5 — Staggered Execution Engine
// Runs every 1 minute via cron-job.org
// Staggered: 15min / 1H / 4H fetched at different minutes
// Price API: Kraken (no Vercel blocks)

const BOT_TOKEN    = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

const TELEGRAM_API   = "https://api.telegram.org/bot" + BOT_TOKEN;
const NADEEM_CHAT_ID = 1123787650;
const PP_OFFSET      = 7; // UTC+7

// Dashboard fire hours (PP time)
const DASHBOARD_HOURS = [8, 12, 16, 20];

// Watchlist coins — Kraken pair names
const WATCHLIST = [
  { key: 'BTC',  krakenPair: 'XXBTZUSD', altPair: 'XBTUSD'  },
  { key: 'ETH',  krakenPair: 'XETHZUSD', altPair: 'ETHUSD'  },
  { key: 'SOL',  krakenPair: 'SOLUSD',   altPair: null       },
  { key: 'AVAX', krakenPair: 'AVAXUSD',  altPair: null       },
  { key: 'LINK', krakenPair: 'LINKUSD',  altPair: null       },
  { key: 'INJ',  krakenPair: 'INJUSD',   altPair: null       }
];

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
      body: JSON.stringify({ chat_id: NADEEM_CHAT_ID, text, parse_mode: 'Markdown' })
    }, 10000);
  } catch (e) { console.log("Telegram error:", e.message); }
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
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetchWT(url, { method, headers, body: body ? JSON.stringify(body) : undefined }, 12000);
      if (!res.ok) throw new Error("Supabase " + res.status);
      return res.json();
    } catch (e) {
      if (i === 1) throw e;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
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

const wasAlertSent = async (key) => {
  try {
    const rows = await supabaseFetch('alex_config', { params: '?key=eq.alert_' + key });
    return rows && rows.length > 0 && rows[0].value === 'true';
  } catch (e) { return false; }
};

const markAlertSent = async (key) => {
  try {
    await supabaseFetch('alex_config', {
      method: 'POST',
      params: '?on_conflict=key',
      body: { key: 'alert_' + key, value: 'true' }
    });
  } catch (e) {}
};

// ============================================================
// GET PHNOM PENH TIME
// ============================================================
const getPPTime = () => {
  const nowUTC = new Date();
  const ppMs = nowUTC.getTime() + (PP_OFFSET * 3600000);
  const pp = new Date(ppMs);
  return {
    hour:    pp.getUTCHours(),
    minute:  pp.getUTCMinutes(),
    dateStr: pp.getUTCFullYear() + '-' +
             String(pp.getUTCMonth() + 1).padStart(2, '0') + '-' +
             String(pp.getUTCDate()).padStart(2, '0'),
    display: String(pp.getUTCHours()).padStart(2,'0') + ':' +
             String(pp.getUTCMinutes()).padStart(2,'0') + ' PPH (+7)'
  };
};

// ============================================================
// IS EU/US SESSION ACTIVE?
// ============================================================
const isActiveSession = (ppHour) => {
  // EU: 12:00 - 20:00 PP time
  // US: 20:00 - 02:00 PP time
  return (ppHour >= 12 && ppHour < 20) || ppHour >= 20 || ppHour < 2;
};

// ============================================================
// KRAKEN PRICE FETCH
// ============================================================
const fetchKrakenPrices = async () => {
  try {
    const pairs = WATCHLIST.map(w => w.krakenPair).join(',');
    const res = await fetchWT(
      'https://api.kraken.com/0/public/Ticker?pair=' + pairs,
      { headers: { 'Accept': 'application/json' } },
      12000
    );
    if (!res.ok) throw new Error("Kraken " + res.status);
    const data = await res.json();
    if (data.error?.length > 0) throw new Error(data.error.join(', '));

    const r = data.result;
    const prices = {};
    const fmt = (p) => p ? '$' + parseFloat(p).toLocaleString('en-US', { minimumFractionDigits: 2 }) : 'N/A';

    for (const coin of WATCHLIST) {
      const pair = r[coin.krakenPair] || r[coin.altPair] || null;
      const price = pair?.c?.[0] ? parseFloat(pair.c[0]) : null;
      prices[coin.key] = { price, display: fmt(price) };
    }
    console.log("Kraken prices fetched — BTC:", prices.BTC?.display);
    return prices;
  } catch (e) {
    console.log("Kraken error:", e.message);
    return null;
  }
};

// ============================================================
// KRAKEN OHLCV FETCH — For indicator calculation
// interval: 15 (15min), 60 (1H), 240 (4H)
// ============================================================
const fetchOHLCV = async (krakenPair, interval) => {
  try {
    const res = await fetchWT(
      'https://api.kraken.com/0/public/OHLC?pair=' + krakenPair + '&interval=' + interval,
      {}, 12000
    );
    if (!res.ok) throw new Error("OHLCV " + res.status);
    const data = await res.json();
    if (data.error?.length > 0) throw new Error(data.error.join(', '));

    // result key is dynamic (pair name)
    const key = Object.keys(data.result).find(k => k !== 'last');
    const candles = data.result[key];
    // Each candle: [time, open, high, low, close, vwap, volume, count]
    return candles.map(c => ({
      time:   parseInt(c[0]),
      open:   parseFloat(c[1]),
      high:   parseFloat(c[2]),
      low:    parseFloat(c[3]),
      close:  parseFloat(c[4]),
      vwap:   parseFloat(c[5]),
      volume: parseFloat(c[6])
    }));
  } catch (e) {
    console.log("OHLCV error (" + krakenPair + " " + interval + "):", e.message);
    return null;
  }
};

// ============================================================
// TECHNICAL INDICATORS
// ============================================================
const calcEMA = (data, period) => {
  const k = 2 / (period + 1);
  let ema = data[0];
  for (let i = 1; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
};

const calcRSI = (closes, period = 14) => {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const rs = gains / (losses || 0.001);
  return 100 - (100 / (1 + rs));
};

const calcATR = (candles, period = 14) => {
  const trs = candles.slice(-period).map((c, i, arr) => {
    if (i === 0) return c.high - c.low;
    const prev = arr[i - 1];
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  });
  return trs.reduce((a, b) => a + b, 0) / trs.length;
};

const calcOBV = (candles) => {
  let obv = 0;
  const obvValues = [0];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i-1].close) obv += candles[i].volume;
    else if (candles[i].close < candles[i-1].close) obv -= candles[i].volume;
    obvValues.push(obv);
  }
  return obvValues;
};

const analyzeCandles = (candles) => {
  if (!candles || candles.length < 50) return null;

  const closes  = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);

  const ema9   = calcEMA(closes.slice(-20),  9);
  const ema21  = calcEMA(closes.slice(-30),  21);
  const ema50  = calcEMA(closes.slice(-60),  50);
  const ema200 = calcEMA(closes,             200);
  const rsi    = calcRSI(closes);
  const atr    = calcATR(candles);

  // Volume spike: current > 1.5x average of last 20
  const avgVol = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
  const volSpike = volumes[volumes.length - 1] > avgVol * 1.5;

  // OBV rising: last 5 OBV values
  const obvVals = calcOBV(candles.slice(-10));
  const obvRising = obvVals[obvVals.length - 1] > obvVals[obvVals.length - 5];

  // VWAP (simplified: last 20 candles)
  const last20 = candles.slice(-20);
  const vwap = last20.reduce((acc, c) => acc + c.vwap * c.volume, 0) /
               last20.reduce((acc, c) => acc + c.volume, 0);

  const currentPrice = closes[closes.length - 1];

  return {
    ema9, ema21, ema50, ema200, rsi, atr,
    volSpike, obvRising, vwap,
    currentPrice,
    ema9AboveEma21:    ema9 > ema21,
    ema50AboveEma200:  ema50 > ema200,
    priceAboveEma50:   currentPrice > ema50,
    priceAboveVwap:    currentPrice > vwap,
    rsiOversold:       rsi < 40,
    rsiNotOverbought:  rsi < 65
  };
};

// ============================================================
// SIGNAL GENERATOR — Alex 1.5 Strategy
// ============================================================
const generateSignal = (coin, analysis15m, analysis4H, currentPrice) => {
  if (!analysis15m || !analysis4H || !currentPrice) return null;

  // All conditions must pass
  const conditions = [
    analysis4H.ema50AboveEma200,    // 4H: Bullish trend
    analysis4H.priceAboveEma50,     // 4H: Price above trend
    analysis15m.ema9AboveEma21,     // 15min: EMA cross
    analysis15m.rsiNotOverbought,   // RSI not overbought
    analysis15m.volSpike,           // Volume confirmation
    analysis15m.priceAboveVwap,     // Price above VWAP
    analysis15m.obvRising           // OBV rising
  ];

  const passedCount = conditions.filter(Boolean).length;
  if (passedCount < 6) return null; // Need at least 6/7

  // ATR based SL/TP
  const atr = analysis15m.atr;
  const sl  = parseFloat((currentPrice - atr * 1.5).toFixed(4));
  const tp1 = parseFloat((currentPrice + atr * 2.25).toFixed(4)); // 1:1.5
  const tp2 = parseFloat((currentPrice + atr * 3.0).toFixed(4));  // 1:2
  const tp3 = parseFloat((currentPrice + atr * 4.5).toFixed(4));  // 1:3

  // Win probability based on conditions met
  const winProb = Math.round(60 + passedCount * 5);

  const reasons = [];
  if (analysis4H.ema50AboveEma200) reasons.push("4H bullish trend");
  if (analysis15m.ema9AboveEma21)  reasons.push("EMA9/21 cross");
  if (analysis15m.rsiOversold)     reasons.push("RSI oversold");
  if (analysis15m.volSpike)        reasons.push("Volume spike");
  if (analysis15m.obvRising)       reasons.push("OBV rising");

  return {
    coin,
    entry: currentPrice,
    sl, tp1, tp2, tp3,
    rr: "1:3",
    winProb,
    reason: reasons.join(' + '),
    passedCount
  };
};

// ============================================================
// 4-HOUR DASHBOARD
// ============================================================
const handleDashboard = async (pp, prices, btcBias) => {
  if (!DASHBOARD_HOURS.includes(pp.hour) || pp.minute !== 0) return;
  const key = 'dashboard_' + pp.dateStr + '_h' + pp.hour;
  if (await wasAlertSent(key)) return;

  // Get cached news
  let news = "📡 News loading...";
  try {
    const rows = await supabaseFetch('alex_config', { params: '?key=eq.cached_news' });
    if (rows?.length > 0) news = rows[0].value;
  } catch (e) {}

  const session = isActiveSession(pp.hour) ? "🟢 Active" : "🔴 Low Volume";

  const msg =
    "📊 *ALEX — " + pp.hour + ":00 MARKET SYNC*\n" +
    "━━━━━━━━━━━━━━━━━━━━\n" +
    "_" + pp.display + "_\n\n" +
    "🔵 *Watchlist (Kraken):*\n" +
    "• BTC:  " + (prices?.BTC?.display || 'N/A') + "\n" +
    "• ETH:  " + (prices?.ETH?.display || 'N/A') + "\n" +
    "• SOL:  " + (prices?.SOL?.display || 'N/A') + "\n" +
    "• AVAX: " + (prices?.AVAX?.display || 'N/A') + "\n" +
    "• LINK: " + (prices?.LINK?.display || 'N/A') + "\n" +
    "• INJ:  " + (prices?.INJ?.display || 'N/A') + "\n\n" +
    "📈 *BTC Bias:* " + (btcBias || "Calculating...") + "\n" +
    "🕐 *Session:* " + session + "\n\n" +
    "🌍 *News:*\n" + news + "\n\n" +
    "⚠️ _Sirf Spot. No leverage. Halal only._";

  const sent = await sendTelegram(msg);
  if (sent !== false) await markAlertSent(key);
};

// ============================================================
// TRADE TP/SL CHECKER
// ============================================================
const handleTrades = async (prices) => {
  if (!prices) return;
  try {
    const trades = await supabaseFetch('alex_virtual_trades', {
      params: '?status=eq.ACTIVE'
    });
    for (const trade of trades) {
      const coinKey = trade.coin_pair.replace('/USDT', '');
      const cp = prices[coinKey]?.price;
      if (!cp) continue;

      // Check Break Even
      if (!trade.break_even_hit && cp >= trade.entry_price + (trade.entry_price - trade.stop_loss)) {
        await supabaseFetch('alex_virtual_trades', {
          method: 'PATCH',
          params: '?id=eq.' + trade.id,
          body: { break_even_hit: true, stop_loss: trade.entry_price }
        });
        await sendTelegram(
          "🛡️ *Break Even, Boss!*\n\n" +
          "*" + trade.coin_pair + "* — SL entry pe move ho gaya!\n" +
          "Ab zero loss possible. 💪"
        );
        continue;
      }

      // Check TP hits
      let newStatus = null;
      let alertMsg = null;

      if (cp >= (trade.take_profit_3 || trade.take_profit)) {
        newStatus = 'TARGET_HIT';
        alertMsg = "🎉 *Alhamdulillah! FULL TARGET HIT Boss!*\n\n" +
          "✅ *" + trade.coin_pair + "*\n" +
          "💰 Full profit locked!\n\n" +
          "Allah ka shukar Sir! 🤲";
      } else if (cp >= (trade.take_profit_2 || trade.take_profit)) {
        await sendTelegram("🎯 *TP2 Hit Boss!*\n*" + trade.coin_pair + "* — Dusra target! 40% aur close karo.");
      } else if (cp >= (trade.take_profit_1 || trade.take_profit)) {
        await sendTelegram("✅ *TP1 Hit Boss!*\n*" + trade.coin_pair + "* — Pehla target! 40% close karo, SL break even pe.");
      } else if (cp <= trade.stop_loss) {
        newStatus = 'LOSS_HIT';
        alertMsg = "🛡️ *Stop Loss Hit Boss.*\n\n" +
          "❌ *" + trade.coin_pair + "*\n" +
          "Capital safe hai Sir. Agli opportunity aayegi Insha'Allah. 🤲";
      }

      if (newStatus) {
        await supabaseFetch('alex_virtual_trades', {
          method: 'PATCH',
          params: '?id=eq.' + trade.id,
          body: { status: newStatus, closed_price: cp, closed_at: new Date().toISOString() }
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
  res.status(200).json({ status: 'OK', time: new Date().toISOString() });

  try {
    const pp = getPPTime();
    const min = pp.minute;
    console.log("Cron — PP:", pp.display, "| Hour:", pp.hour, "| Min:", min);

    // Always fetch current prices
    const prices = await fetchKrakenPrices();

    // ── STAGGERED EXECUTION ──────────────────────────────────
    // :00, :15, :30, :45 → 15min OHLCV + signals
    // :05, :20, :35, :50 → 1H OHLCV
    // :10, :25, :40, :55 → 4H OHLCV + BTC bias
    // All others          → Trade check only

    let btcBias = null;
    let signalFired = false;

    if (min % 15 === 10) {
      // 4H candles — BTC trend direction
      console.log("Fetching 4H OHLCV...");
      const btc4H = await fetchOHLCV('XXBTZUSD', 240);
      if (btc4H) {
        const a = analyzeCandles(btc4H);
        if (a) {
          btcBias = a.ema50AboveEma200 && a.priceAboveEma50
            ? "🟢 Bullish"
            : !a.ema50AboveEma200
            ? "🔴 Bearish"
            : "🟡 Sideways";
          await setConfig('btc_bias', btcBias);
          console.log("BTC 4H Bias:", btcBias);
        }
      }

    } else if (min % 15 === 5) {
      // 1H candles — trend confirmation
      console.log("Fetching 1H OHLCV...");
      const btc1H = await fetchOHLCV('XXBTZUSD', 60);
      if (btc1H) {
        const a = analyzeCandles(btc1H);
        if (a) {
          console.log("BTC 1H RSI:", a.rsi?.toFixed(1), "EMA50>200:", a.ema50AboveEma200);
        }
      }

    } else if (min % 15 === 0) {
      // 15min candles — entry signals
      console.log("Fetching 15min OHLCV + signal check...");

      // Get cached BTC bias
      let cachedBias = "Unknown";
      try {
        const rows = await supabaseFetch('alex_config', { params: '?key=eq.btc_bias' });
        if (rows?.length > 0) cachedBias = rows[0].value;
      } catch (e) {}

      const btcBearish = cachedBias === "🔴 Bearish";
      const activeSession = isActiveSession(pp.hour);

      if (!btcBearish && activeSession) {
        // Scan altcoins for signals
        for (const coin of WATCHLIST) {
          if (coin.key === 'BTC') continue;
          if (!prices?.[coin.key]?.price) continue;

          // Fetch 4H for trend
          const candles4H = await fetchOHLCV(coin.krakenPair, 240);
          const analysis4H = analyzeCandles(candles4H);

          // Fetch 15min for entry
          const candles15m = await fetchOHLCV(coin.krakenPair, 15);
          const analysis15m = analyzeCandles(candles15m);

          const signal = generateSignal(coin.key, analysis15m, analysis4H, prices[coin.key].price);
          if (!signal || signal.winProb < 65) continue;

          // Avoid duplicate signals
          const sigKey = 'signal_' + coin.key + '_' + pp.dateStr;
          if (await wasAlertSent(sigKey)) continue;

          // Save virtual trade
          try {
            await supabaseFetch('alex_virtual_trades', {
              method: 'POST',
              body: {
                coin_pair: coin.key + '/USDT',
                direction: 'BUY',
                entry_price: signal.entry,
                take_profit_1: signal.tp1,
                take_profit_2: signal.tp2,
                take_profit_3: signal.tp3,
                take_profit: signal.tp3,
                stop_loss: signal.sl,
                win_probability: signal.winProb,
                risk_reward: '1:3',
                structural_reason: signal.reason,
                status: 'ACTIVE',
                break_even_hit: false
              }
            });
          } catch (e) {}

          await sendTelegram(
            "⚡ *SIGNAL ALERT, Boss!*\n\n" +
            "🪙 *Coin:* " + signal.coin + "/USDT\n" +
            "📊 *Direction:* SPOT BUY\n" +
            "📍 *Entry:* $" + signal.entry.toLocaleString() + "\n\n" +
            "🎯 *TP1:* $" + signal.tp1.toLocaleString() + " _(40% exit)_\n" +
            "🎯 *TP2:* $" + signal.tp2.toLocaleString() + " _(40% exit)_\n" +
            "🎯 *TP3:* $" + signal.tp3.toLocaleString() + " _(20% exit)_\n\n" +
            "🛑 *SL:* $" + signal.sl.toLocaleString() + "\n" +
            "📊 *Win Prob:* " + signal.winProb + "%\n" +
            "⚖️ *R:R:* " + signal.rr + "\n" +
            "🕐 *Session:* " + (isActiveSession(pp.hour) ? "EU/US Active ✅" : "Low Volume ⚠️") + "\n\n" +
            "📝 _" + signal.reason + "_\n\n" +
            "Manually confirm karein Sir! 🚀"
          );

          await markAlertSent(sigKey);
          signalFired = true;
          break; // One signal per scan
        }
      }
    }

    // Always check trades
    await handleTrades(prices);

    // Dashboard check
    await handleDashboard(pp, prices, btcBias);

    console.log("Cron complete. Signal fired:", signalFired);

  } catch (err) {
    console.log("Cron crash:", err.message);
  }
};
