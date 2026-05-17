// api/prices.js — ALEX CORE v1.5 — Price Fetcher & Cacher
// Runs every 5 minutes via cron-job.org (Job 3)
// Tries multiple APIs until one works
// Saves to Supabase — cron.js reads from cache

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

// Watchlist
const COINS = [
  { key: 'BTC',  ids: { gecko: 'bitcoin',       paprika: 'btc-bitcoin',    compare: 'BTC'  } },
  { key: 'ETH',  ids: { gecko: 'ethereum',      paprika: 'eth-ethereum',   compare: 'ETH'  } },
  { key: 'SOL',  ids: { gecko: 'solana',         paprika: 'sol-solana',     compare: 'SOL'  } },
  { key: 'AVAX', ids: { gecko: 'avalanche-2',   paprika: 'avax-avalanche', compare: 'AVAX' } },
  { key: 'LINK', ids: { gecko: 'chainlink',     paprika: 'link-chainlink', compare: 'LINK' } },
  { key: 'INJ',  ids: { gecko: 'injective-protocol', paprika: 'inj-injective-protocol', compare: 'INJ' } }
];

// ============================================================
// FETCH WITH TIMEOUT
// ============================================================
const fetchWT = async (url, options = {}, timeout = 12000) => {
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
// SUPABASE CACHE SAVE
// ============================================================
const supabaseSave = async (key, value) => {
  // First try to delete existing key, then insert fresh
  const baseUrl = SUPABASE_URL + '/rest/v1/alex_config';
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  // Delete existing
  try {
    await fetchWT(baseUrl + '?key=eq.' + key, {
      method: 'DELETE',
      headers
    }, 8000);
  } catch (e) {}

  // Insert fresh
  const res = await fetchWT(baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ key, value: JSON.stringify(value) })
  }, 12000);

  if (!res.ok) {
    const err = await res.text();
    throw new Error("Supabase save error: " + res.status + " " + err);
  }
  return res.json();
};

// ============================================================
// SOURCE 1: CoinGecko (Free, no key needed)
// ============================================================
const fetchCoinGecko = async () => {
  const ids = COINS.map(c => c.ids.gecko).join(',');
  const res = await fetchWT(
    'https://api.coingecko.com/api/v3/simple/price?ids=' + ids + '&vs_currencies=usd&include_24hr_change=true',
    { headers: { 'Accept': 'application/json' } },
    10000
  );
  if (!res.ok) throw new Error("CoinGecko " + res.status);
  const data = await res.json();

  const prices = {};
  for (const coin of COINS) {
    const d = data[coin.ids.gecko];
    prices[coin.key] = {
      price:  d?.usd || null,
      change: d?.usd_24h_change || null
    };
  }
  console.log("Prices from CoinGecko ✅");
  return prices;
};

// ============================================================
// SOURCE 2: CryptoCompare (Free tier)
// ============================================================
const fetchCryptoCompare = async () => {
  const fsyms = COINS.map(c => c.ids.compare).join(',');
  const res = await fetchWT(
    'https://min-api.cryptocompare.com/data/pricemultifull?fsyms=' + fsyms + '&tsyms=USD',
    { headers: { 'Accept': 'application/json' } },
    10000
  );
  if (!res.ok) throw new Error("CryptoCompare " + res.status);
  const data = await res.json();
  if (!data.RAW) throw new Error("CryptoCompare no data");

  const prices = {};
  for (const coin of COINS) {
    const d = data.RAW?.[coin.ids.compare]?.USD;
    prices[coin.key] = {
      price:  d?.PRICE || null,
      change: d?.CHANGEPCT24HOUR || null
    };
  }
  console.log("Prices from CryptoCompare ✅");
  return prices;
};

// ============================================================
// SOURCE 3: Coinpaprika (Free, different CDN)
// ============================================================
const fetchCoinpaprika = async () => {
  const prices = {};
  for (const coin of COINS) {
    try {
      const res = await fetchWT(
        'https://api.coinpaprika.com/v1/tickers/' + coin.ids.paprika + '?quotes=USD',
        {}, 8000
      );
      if (!res.ok) throw new Error("Coinpaprika " + res.status);
      const data = await res.json();
      prices[coin.key] = {
        price:  data?.quotes?.USD?.price || null,
        change: data?.quotes?.USD?.percent_change_24h || null
      };
    } catch (e) {
      prices[coin.key] = { price: null, change: null };
    }
  }
  console.log("Prices from Coinpaprika ✅");
  return prices;
};

// ============================================================
// MAIN HANDLER
// ============================================================
module.exports = async (req, res) => {
  try {
    console.log("Price fetcher starting...");

    let prices = null;

    // Try sources one by one
    const sources = [
      { name: 'CoinGecko',     fn: fetchCoinGecko     },
      { name: 'CryptoCompare', fn: fetchCryptoCompare },
      { name: 'Coinpaprika',   fn: fetchCoinpaprika   }
    ];

    for (const source of sources) {
      try {
        prices = await source.fn();
        // Verify BTC price exists
        if (prices?.BTC?.price) {
          console.log("Using:", source.name, "| BTC: $" + prices.BTC.price);
          break;
        }
      } catch (e) {
        console.log(source.name, "failed:", e.message);
      }
    }

    if (!prices || !prices.BTC?.price) {
      console.log("All price sources failed!");
      return res.status(200).json({ status: 'error', message: 'All sources failed' });
    }

    // Format prices for display
    const fmt = (p) => p ? '$' + parseFloat(p).toLocaleString('en-US', { minimumFractionDigits: 2 }) : 'N/A';
    const chg = (c) => {
      if (!c) return '';
      const n = parseFloat(c);
      return n > 0 ? ' 📈 +' + n.toFixed(2) + '%' : ' 📉 ' + n.toFixed(2) + '%';
    };

    const formatted = {};
    for (const coin of COINS) {
      formatted[coin.key] = {
        price:   prices[coin.key].price,
        change:  prices[coin.key].change,
        display: fmt(prices[coin.key].price) + chg(prices[coin.key].change)
      };
    }

    // Save to Supabase cache
    await supabaseSave('cached_prices', {
      prices: formatted,
      updated_at: new Date().toISOString()
    });

    console.log("Prices cached in Supabase ✅");

    return res.status(200).json({
      status: 'OK',
      BTC: formatted.BTC.display,
      ETH: formatted.ETH.display,
      SOL: formatted.SOL.display,
      updated: new Date().toISOString()
    });

  } catch (err) {
    console.log("Price fetcher crash:", err.message);
    return res.status(200).json({ status: 'error', error: err.message });
  }
};
