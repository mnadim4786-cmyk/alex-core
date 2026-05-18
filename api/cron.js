// api/cron.js — ALEX CORE v1.5 — Staggered Execution Engine
// Prices: Kraken API
// OHLCV: Bybit API (Kraken OHLCV blocked on Vercel)
// Runs every 1 minute via cron-job.org

const BOT_TOKEN    = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

const TELEGRAM_API   = "https://api.telegram.org/bot" + BOT_TOKEN;
const NADEEM_CHAT_ID = 1123787650;
const PP_OFFSET      = 7; // UTC+7

const DASHBOARD_HOURS = [8, 12, 16, 20];

// Watchlist — Kraken pair + Bybit symbol
const WATCHLIST = [
  { key: 'BTC',  krakenPair: 'XXBTZUSD', bybitSymbol: 'BTCUSDT'  },
  { key: 'ETH',  krakenPair: 'XETHZUSD', bybitSymbol: 'ETHUSDT'  },
  { key: 'SOL',  krakenPair: 'SOLUSD',   bybitSymbol: 'SOLUSDT'  },
  { key: 'AVAX', krakenPair: 'AVAXUSD',  bybitSymbol: 'AVAXUSDT' },
  { key: 'LINK', krakenPair: 'LINKUSD',  bybitSymbol: 'LINKUSDT' },
  { key: 'INJ',  krakenPair: 'INJUSD',   bybitSymbol: 'INJUSDT'  }
];

// ============================================================
// FETCH WITH TIMEOUT
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

// ============================================================
// TELEGRAM
// ============================================================
const sendTelegram = async (text) => {
  try {
    await fetchWT(TELEGRAM_API + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: NADEEM_CHAT_ID, text, parse_mode: 'Markdown' })
    }, 10000);
  } catch (e) { console.log("Telegram error:", e.message); }
};

// ============================================================
// SUPABASE
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
// SESSION CHECK
// ============================================================
const isActiveSession = (ppHour) => {
  return (ppHour >= 12 && ppHour < 20) || ppHour >= 20 || ppHour < 2;
};

// ============================================================
// CRYPTO PRICES — CoinGecko Direct (Works on Vercel)
// ============================================================
const fetchKrakenPrices = async () => {
  try {
    const ids = 'bitcoin,ethereum,solana,avalanche-2,chainlink,injective-protocol';
    const res = await fetchWT(
      'https://api.coingecko.com/api/v3/simple/price?ids=' + ids + '&vs_currencies=usd&include_24hr_change=true',
      { headers: { 'Accept': 'application/json' } },
      12000
    );
    if (!res.ok) throw new Error("CoinGecko " + res.status);
    const d = await res.json();

    const fmt = (p) => p ? '$' + parseFloat(p).toLocaleString('en-US', { minimumFractionDigits: 2 }) : 'N/A';

    const prices = {
      BTC:  { price: d.bitcoin?.usd,                display: fmt(d.bitcoin?.usd)                },
      ETH:  { price: d.ethereum?.usd,               display: fmt(d.ethereum?.usd)               },
      SOL:  { price: d.solana?.usd,                 display: fmt(d.solana?.usd)                 },
      AVAX: { price: d['avalanche-2']?.usd,         display: fmt(d['avalanche-2']?.usd)         },
      LINK: { price: d.chainlink?.usd,              display: fmt(d.chainlink?.usd)              },
      INJ:  { price: d['injective-protocol']?.usd,  display: fmt(d['injective-protocol']?.usd)  }
    };

    console.log("CoinGecko prices OK — BTC:", prices.BTC.display);
    return prices;
  } catch (e) {
    console.log("CoinGecko price error:", e.message);
    return null;
  }
};

// ============================================================
// BYBIT OHLCV FETCH
// interval: '15' = 15min, '60' = 1H, '240' = 4H
// ============================================================
const fetchBybitOHLCV = async (symbol, interval, limit = 200) => {
  try {
    const url = 'https://api.bybit.com/v5/market/kline?category=spot&symbol=' +
                symbol + '&interval=' + interval + '&limit=' + limit;
    const res = await fetchWT(url, { headers: { 'Accept': 'application/json' } }, 12000);
    if (!res.ok) throw new Error("Bybit " + res.status);
    const data = await res.json();
    if (data.retCode !== 0) throw new Error("Bybit: " + data.retMsg);

    // Bybit returns: [startTime, open, high, low, close, volume, turnover]
    // Sorted newest first — reverse for chronological order
    const candles = data.result.list.reverse().map(c => ({
      time:   parseInt(c[0]),
      open:   parseFloat(c[1]),
      high:   parseFloat(c[2]),
      low:    parseFloat(c[3]),
      close:  parseFloat(c[4]),
      volume: parseFloat(c[5])
    }));
    return candles;
  } catch (e) {
    console.log("Bybit OHLCV error (" + symbol + " " + interval + "):", e.message);
    return null;
  }
};

// ============================================================
// TECHNICAL INDICATORS
// ============================================================
const calcEMA = (closes, period) => {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
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
  const avgGain = gains / period;
  const avgLoss = losses / period;
  const rs = avgGain / (avgLoss || 0.001);
  return 100 - (100 / (1 + rs));
};

const calcATR = (candles, period = 14) => {
  if (candles.length < period + 1) return null;
  const recent = candles.slice(-period - 1);
  const trs = [];
  for (let i = 1; i < recent.length; i++) {
    const tr = Math.max(
      recent[i].high - recent[i].low,
      Math.abs(recent[i].high - recent[i-1].close),
      Math.abs(recent[i].low  - recent[i-1].close)
    );
    trs.push(tr);
  }
  return trs.reduce((a, b) => a + b, 0) / trs.length;
};

const calcOBV = (candles) => {
  let obv = 0;
  const vals = [0];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i-1].close)      obv += candles[i].volume;
    else if (candles[i].close < candles[i-1].close) obv -= candles[i].volume;
    vals.push(obv);
  }
  return vals;
};

const analyzeCandles = (candles) => {
  if (!candles || candles.length < 50) return null;
  const closes  = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);

  const ema9   = calcEMA(closes, 9);
  const ema21  = calcEMA(closes, 21);
  const ema50  = calcEMA(closes, 50);
  const ema200 = calcEMA(closes, 200);
  const rsi    = calcRSI(closes);
  const atr    = calcATR(candles);

  // Volume spike: current > 1.5x avg of last 20
  const avgVol  = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
  const volSpike = volumes[volumes.length - 1] > avgVol * 1.5;

  // OBV trend: last value vs 5 candles ago
  const obvVals   = calcOBV(candles.slice(-10));
  const obvRising = obvVals[obvVals.length - 1] > obvVals[Math.max(0, obvVals.length - 5)];

  // VWAP simplified: last 20 candles
  const last20 = candles.slice(-20);
  const totalVol = last20.reduce((acc, c) => acc + c.volume, 0);
  const vwap = totalVol > 0
    ? last20.reduce((acc, c) => acc + ((c.high + c.low + c.close) / 3) * c.volume, 0) / totalVol
    : closes[closes.length - 1];

  const currentPrice = closes[closes.length - 1];

  return {
    ema9, ema21, ema50, ema200, rsi, atr,
    volSpike, obvRising, vwap, currentPrice,
    ema9AboveEma21:   ema9 > ema21,
    ema50AboveEma200: ema50 > ema200,
    priceAboveEma50:  currentPrice > ema50,
    priceAboveVwap:   currentPrice > vwap,
    rsiOversold:      rsi < 40,
    rsiNotOverbought: rsi < 65
  };
};

// ============================================================
// SIGNAL GENERATOR
// ============================================================
const generateSignal = (coin, a15m, a4H, currentPrice) => {
  if (!a15m || !a4H || !currentPrice) return null;

  const conditions = [
    a4H.ema50AboveEma200,    // 4H bullish trend
    a4H.priceAboveEma50,     // Price above 4H trend
    a15m.ema9AboveEma21,     // 15min EMA cross
    a15m.rsiNotOverbought,   // RSI not overbought
    a15m.volSpike,           // Volume confirmation
    a15m.priceAboveVwap,     // Above VWAP
    a15m.obvRising           // Smart money accumulating
  ];

  const passed = conditions.filter(Boolean).length;
  if (passed < 6) return null;

  const atr = a15m.atr;
  if (!atr) return null;

  const sl  = parseFloat((currentPrice - atr * 1.5).toFixed(6));
  const tp1 = parseFloat((currentPrice + atr * 2.25).toFixed(6)); // 1:1.5
  const tp2 = parseFloat((currentPrice + atr * 3.0).toFixed(6));  // 1:2
  const tp3 = parseFloat((currentPrice + atr * 4.5).toFixed(6));  // 1:3

  const winProb = Math.round(60 + passed * 5);

  const reasons = [];
  if (a4H.ema50AboveEma200)  reasons.push("4H trend bullish");
  if (a15m.ema9AboveEma21)   reasons.push("EMA 9/21 cross");
  if (a15m.rsiOversold)      reasons.push("RSI oversold");
  if (a15m.volSpike)         reasons.push("Volume spike");
  if (a15m.priceAboveVwap)   reasons.push("Above VWAP");
  if (a15m.obvRising)        reasons.push("OBV rising");

  return { coin, entry: currentPrice, sl, tp1, tp2, tp3, rr: "1:3", winProb, reason: reasons.join(' + ') };
};

// ============================================================
// 4-HOUR DASHBOARD
// ============================================================
const handleDashboard = async (pp, prices) => {
  if (!DASHBOARD_HOURS.includes(pp.hour) || pp.minute !== 0) return;
  const key = 'dashboard_' + pp.dateStr + '_h' + pp.hour;
  if (await wasAlertSent(key)) return;

  let news = "📡 News loading...";
  let btcBias = "Calculating...";
  try {
    const rows = await supabaseFetch('alex_config', {
      params: '?key=in.(cached_news,btc_bias)'
    });
    for (const row of rows) {
      if (row.key === 'cached_news') news = row.value;
      if (row.key === 'btc_bias') btcBias = row.value;
    }
  } catch (e) {}

  const session = isActiveSession(pp.hour) ? "🟢 EU/US Active" : "🔴 Low Volume";

  const msg =
    "📊 *ALEX — " + pp.hour + ":00 MARKET SYNC*\n" +
    "━━━━━━━━━━━━━━━━━━━━\n" +
    "_" + pp.display + "_\n\n" +
    "🔵 *Watchlist:*\n" +
    "• BTC:  " + (prices?.BTC?.display  || 'N/A') + "\n" +
    "• ETH:  " + (prices?.ETH?.display  || 'N/A') + "\n" +
    "• SOL:  " + (prices?.SOL?.display  || 'N/A') + "\n" +
    "• AVAX: " + (prices?.AVAX?.display || 'N/A') + "\n" +
    "• LINK: " + (prices?.LINK?.display || 'N/A') + "\n" +
    "• INJ:  " + (prices?.INJ?.display  || 'N/A') + "\n\n" +
    "📈 *BTC Bias:* " + btcBias + "\n" +
    "🕐 *Session:* " + session + "\n\n" +
    "🌍 *News:*\n" + news + "\n\n" +
    "⚠️ _Sirf Spot. No leverage. Halal only._";

  await sendTelegram(msg);
  await markAlertSent(key);
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

      const riskDist = trade.entry_price - trade.stop_loss;

      // Break Even check — when 1:1 hit
      if (!trade.break_even_hit && cp >= trade.entry_price + riskDist) {
        try {
          await supabaseFetch('alex_virtual_trades', {
            method: 'PATCH',
            params: '?id=eq.' + trade.id,
            body: { break_even_hit: true, stop_loss: trade.entry_price }
          });
          await sendTelegram(
            "🛡️ *Break Even Hit, Boss!*\n\n" +
            "*" + trade.coin_pair + "* — SL entry pe move!\n" +
            "Ab zero loss possible. 💪"
          );
        } catch (e) {}
        continue;
      }

      let newStatus = null;
      let alertMsg  = null;

      if (cp >= (trade.take_profit_3 || trade.take_profit)) {
        newStatus = 'TARGET_HIT';
        alertMsg =
          "🎉 *Alhamdulillah! FULL TARGET Boss!*\n\n" +
          "✅ *" + trade.coin_pair + "* — Poora profit!\n" +
          "Allah ka shukar Sir! 🤲";
      } else if (trade.take_profit_2 && cp >= trade.take_profit_2) {
        await sendTelegram("🎯 *TP2 Hit Boss!*\n*" + trade.coin_pair + "* — Dusra target! 40% close karo.");
      } else if (trade.take_profit_1 && cp >= trade.take_profit_1) {
        await sendTelegram("✅ *TP1 Hit Boss!*\n*" + trade.coin_pair + "* — Pehla target! 40% close karo.");
      } else if (cp <= trade.stop_loss) {
        newStatus = 'LOSS_HIT';
        alertMsg =
          "🛡️ *SL Hit Boss.*\n\n" +
          "❌ *" + trade.coin_pair + "*\n" +
          "Capital safe. Agli opportunity Insha'Allah. 🤲";
      }

      if (newStatus) {
        try {
          await supabaseFetch('alex_virtual_trades', {
            method: 'PATCH',
            params: '?id=eq.' + trade.id,
            body: { status: newStatus, closed_price: cp, closed_at: new Date().toISOString() }
          });
        } catch (e) {}
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
  try {
    const pp  = getPPTime();
    const min = pp.minute;
    console.log("Cron — PP:", pp.display, "| Hour:", pp.hour, "| Min:", min);

    // Always fetch live prices
    const prices = await fetchKrakenPrices();

    // ── STAGGERED EXECUTION ──────────────────────────────────
    // min % 15 === 10 → 4H OHLCV (Bybit) — BTC bias
    // min % 15 === 5  → 1H OHLCV (Bybit) — trend confirm
    // min % 15 === 0  → 15min OHLCV (Bybit) — entry signals
    // others          → trade check only

    if (min % 15 === 10) {
      // ── 4H BTC BIAS ─────────────────────────────────────
      console.log("Fetching 4H OHLCV (Bybit)...");
      const candles4H = await fetchBybitOHLCV('BTCUSDT', '240', 220);
      if (candles4H) {
        const a = analyzeCandles(candles4H);
        if (a) {
          const bias = a.ema50AboveEma200 && a.priceAboveEma50
            ? "🟢 Bullish"
            : !a.ema50AboveEma200
            ? "🔴 Bearish"
            : "🟡 Sideways";
          await setConfig('btc_bias', bias);
          console.log("BTC 4H Bias saved:", bias);
        }
      }

    } else if (min % 15 === 5) {
      // ── 1H TREND CONFIRM ────────────────────────────────
      console.log("Fetching 1H OHLCV (Bybit)...");
      const candles1H = await fetchBybitOHLCV('BTCUSDT', '60', 220);
      if (candles1H) {
        const a = analyzeCandles(candles1H);
        if (a) {
          console.log("BTC 1H — RSI:", a.rsi?.toFixed(1), "EMA50>200:", a.ema50AboveEma200);
        }
      }

    } else if (min % 15 === 0) {
      // ── 15MIN SIGNAL SCAN ───────────────────────────────
      console.log("15min signal scan starting...");

      let btcBias = "Unknown";
      try {
        const rows = await supabaseFetch('alex_config', { params: '?key=eq.btc_bias' });
        if (rows?.length > 0) btcBias = rows[0].value;
      } catch (e) {}

      const btcBearish   = btcBias === "🔴 Bearish";
      const activeSession = isActiveSession(pp.hour);

      console.log("BTC Bias:", btcBias, "| Session active:", activeSession);

      if (!btcBearish && activeSession && prices) {
        for (const coin of WATCHLIST) {
          if (coin.key === 'BTC') continue;
          if (!prices[coin.key]?.price) continue;

          const sigKey = 'signal_' + coin.key + '_' + pp.dateStr;
          if (await wasAlertSent(sigKey)) continue;

          console.log("Scanning", coin.key, "...");

          // Fetch 4H for trend
          const c4H = await fetchBybitOHLCV(coin.bybitSymbol, '240', 220);
          const a4H = analyzeCandles(c4H);

          // Fetch 15min for entry
          const c15m = await fetchBybitOHLCV(coin.bybitSymbol, '15', 200);
          const a15m = analyzeCandles(c15m);

          const signal = generateSignal(coin.key, a15m, a4H, prices[coin.key].price);
          if (!signal || signal.winProb < 65) {
            console.log(coin.key, "— No signal (conditions:", signal?.passedCount || 0, "/7)");
            continue;
          }

          console.log("Signal found:", coin.key, "Win:", signal.winProb + "%");

          // Save virtual trade
          try {
            await supabaseFetch('alex_virtual_trades', {
              method: 'POST',
              body: {
                coin_pair:         coin.key + '/USDT',
                direction:         'BUY',
                entry_price:       signal.entry,
                take_profit_1:     signal.tp1,
                take_profit_2:     signal.tp2,
                take_profit_3:     signal.tp3,
                take_profit:       signal.tp3,
                stop_loss:         signal.sl,
                win_probability:   signal.winProb,
                risk_reward:       '1:3',
                structural_reason: signal.reason,
                status:            'ACTIVE',
                break_even_hit:    false
              }
            });
          } catch (e) { console.log("Trade save error:", e.message); }

          await sendTelegram(
            "⚡ *SIGNAL ALERT, Boss!*\n\n" +
            "🪙 *Coin:* " + signal.coin + "/USDT\n" +
            "📊 *Direction:* SPOT BUY\n" +
            "📍 *Entry:* $" + signal.entry.toLocaleString('en-US', { minimumFractionDigits: 2 }) + "\n\n" +
            "🎯 *TP1:* $" + signal.tp1.toLocaleString('en-US', { minimumFractionDigits: 2 }) + " _(40% exit)_\n" +
            "🎯 *TP2:* $" + signal.tp2.toLocaleString('en-US', { minimumFractionDigits: 2 }) + " _(40% exit)_\n" +
            "🎯 *TP3:* $" + signal.tp3.toLocaleString('en-US', { minimumFractionDigits: 2 }) + " _(20% exit)_\n\n" +
            "🛑 *SL:* $" + signal.sl.toLocaleString('en-US', { minimumFractionDigits: 2 }) + "\n" +
            "📊 *Win Prob:* " + signal.winProb + "%\n" +
            "⚖️ *R:R:* " + signal.rr + "\n" +
            "🕐 *Session:* " + (activeSession ? "EU/US Active ✅" : "⚠️") + "\n\n" +
            "📝 _" + signal.reason + "_\n\n" +
            "_Manually confirm karein Sir!_ 🚀"
          );

          await markAlertSent(sigKey);
          break; // One signal per scan cycle
        }
      } else {
        console.log("Signal scan skipped — BTC bearish or session inactive.");
      }
    }

    // Always check trades + dashboard
    await handleTrades(prices);
    await handleDashboard(pp, prices);

    console.log("Cron complete ✅");
    return res.status(200).json({ status: 'OK', time: new Date().toISOString() });

  } catch (err) {
    console.log("Cron crash:", err.message);
    return res.status(200).json({ status: 'OK', error: err.message });
  }
};
