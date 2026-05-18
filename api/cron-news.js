// api/cron-news.js — ALEX CORE v1.5 — Hourly News Engine
// Runs every 1 hour via cron-job.org (separate job)
// Fetches news via DeepSeek and caches in Supabase

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const DEEPSEEK_API = "https://api.deepseek.com/v1/chat/completions";

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

const supabaseFetch = async (table, options = {}) => {
  const { method = 'GET', body, params = '' } = options;
  const url = SUPABASE_URL + '/rest/v1/' + table + params;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
  const res = await fetchWT(url, { method, headers, body: body ? JSON.stringify(body) : undefined }, 12000);
  if (!res.ok) throw new Error("Supabase " + res.status);
  return res.json();
};

module.exports = async (req, res) => {
  try {
    console.log("News cron running...");

    const newsRes = await fetchWT(DEEPSEEK_API, {
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
            content: 'You are a sharp crypto and world markets analyst. Give 5 bullet points of the most important news RIGHT NOW that could move crypto markets. Focus on: Fed/macro, geopolitical events, major crypto news, regulatory updates. Hinglish me likho. Each point max 1 line. No preamble. No intro.'
          },
          {
            role: 'user',
            content: 'Latest market-moving news summary abhi.'
          }
        ],
        temperature: 0.4,
        max_tokens: 400
      })
    }, 18000);

    const data = await newsRes.json();
    if (!newsRes.ok) throw new Error("DeepSeek " + newsRes.status);

    const news = data.choices[0].message.content;
    console.log("News fetched:", news.substring(0, 50));

    // Save to Supabase using proper upsert
    const saveRes = await fetchWT(
      SUPABASE_URL + '/rest/v1/alex_config',
      {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=representation'
        },
        body: JSON.stringify({ key: 'cached_news', value: news })
      },
      10000
    );

    if (!saveRes.ok) {
      const err = await saveRes.text();
      console.log("News save error:", err);
    } else {
      console.log("News cached in Supabase success!");
    }

    return res.status(200).json({ status: 'OK', time: new Date().toISOString() });

  } catch (err) {
    console.log("News cron error:", err.message);
    return res.status(200).json({ status: 'error', error: err.message });
  }
};
