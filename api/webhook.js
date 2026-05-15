// api/webhook.js — Production-ready Serverless Webhook Handler for Alex the Telegram AI Agent
// Deployed on Vercel with Supabase + DeepSeek

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL ? process.env.SUPABASE_URL.replace(/\/+$/, '') : ''; // strip trailing slash safely
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// ---------- Helper: fetch with timeout ----------
const fetchWithTimeout = async (url, options = {}, timeout = 15000) => {
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
  const url = `${SUPABASE_URL}/rest/v1/${table}${params}`;
  const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
  const res = await fetchWithTimeout(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`Supabase ${table} error: ${res.status} ${await res.text()}`);
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
  } catch (e) {
    console.log("Config fetch error:", e.message);
    return {};
  }
};

// ---------- Chat memory management ----------
const CHAT_HISTORY_LIMIT = 20;

const getChatHistory = async (chatId) => {
  try {
    const rows = await supabaseFetch('alex_memory', {
      params: `?chat_id=eq.${chatId}&order=created_at.asc&limit=${CHAT_HISTORY_LIMIT}`
    });
    return rows.map(r => ({ role: r.role, content: r.content }));
  } catch (e) {
    console.log("History log pull failed:", e.message);
    return [];
  }
};

const saveChatMessage = async (chatId, role, content) => {
  try {
    await supabaseFetch('alex_memory', {
      method: 'POST',
      body: { chat_id: String(chatId), role, content }
    });
  } catch (e) {
    console.log("Memory save error:", e.message);
  }
};

// ---------- Live crypto prices from Binance ----------
const getCryptoPrices = async () => {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  const prices = {};
  for (const sym of symbols) {
    try {
      const res = await fetchWithTimeout(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}`);
      const data = await res.json();
      prices[sym.replace('USDT', '')] = parseFloat(data.price).toFixed(2);
    } catch (e) {
      prices[sym.replace('USDT', '')] = "Offline";
    }
  }
  return prices;
};

// ---------- Language detection ----------
const detectLanguage = (text) => {
  if (/[\u0900-\u097F]/.test(text)) return 'hindi';
  if (/\b(kyu|kya|hai|nahi|hain|aap|tum|mein|kaise|ho|raha|rahi|diya|liya|karo|karein)\b/i.test(text)) return 'hinglish';
  return 'english';
};

// ---------- Build system prompt ----------
const buildSystemPrompt = (config, isNadeem, userName, language, prices) => {
  let prompt = config.system_prompt || 'You are Alex, a loyal smart personal companion. Speak in Hinglish.';
  
  // Dynamic identity consciousness rules
  if (isNadeem) {
    prompt += `\nYou are speaking directly to NADEEM BHAI (Your Creator and Boss). Always address him as "Sir" or "Boss" with absolute loyalty, deep respect, high energy, and calm intelligence. Maintain your signature Hinglish style.`;
  } else {
    prompt += `\nThe user is a GUEST named ${userName}. Address them as "Sir/Ma'am" initially. If they ask to be called by name or specify a greeting preference, adapt instantly to make them feel comfortable and normal. Never confuse identity or call yourself anything else.`;
  }
  
  // Dynamic Language Mirroring Policies
  if (language === 'hindi') {
    prompt += `\nRespond strictly in pure Hindi framework.`;
  } else if (language === 'hinglish') {
    prompt += `\nRespond strictly in active Hinglish (mix of Hindi and English).`;
  } else {
    prompt += `\nRespond strictly in professional, crisp English.`;
  }
  
  // Islamic ethical guardrails
  prompt += `\nYou operate strictly under Shariyah, Quran, and Sunnah. Only analyze Crypto Spot assets. If any user asks for leverage, margin, CFDs, futures, interest (Riba/Sood), or short-selling, you MUST SAKTI SE REFUSE the order. Explain the Shariyah compliance rule with love and calmness to protect their Aakhirat.`;
  
  // Trading signal limits criteria
  prompt += `\nOnly recommend a trading signal if Risk-to-Reward ratio is minimum 1:3 and win probability is above 70%. Signal must include Entry Range, TP, SL, Win Success %, and brief valid structural reasons.`;
  
  // Real-time currency configurations
  if (config.watchlist_coins) prompt += `\nWatchlist coins parameters: ${config.watchlist_coins}`;
  
  // Real-time market context variables injection
  prompt += `\nToday's context: Date is Saturday, May 16, 2026. Live Crypto Tickers: Bitcoin is $${prices.BTC} | Ethereum is $${prices.ETH} | Solana is $${prices.SOL}. Provide localized responses based on incoming timezone stamps.`;
  return prompt;
};

// ---------- DeepSeek API call ----------
const callDeepSeek = async (systemPrompt, history, userText) => {
  const url = 'https://api.deepseek.com/v1/chat/completions';
  const formattedMessages = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: userText }];
  
  const body = {
    model: 'deepseek-chat',
    messages: formattedMessages,
    temperature: 0.5,
    max_tokens: 1000
  };
  
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify(body)
  });
  
  const data = await res.json();
  if (!res.ok) throw new Error(`DeepSeek error: ${data.error?.message || res.status}`);
  return data.choices[0].message.content;
};

// ---------- Send Telegram message ----------
const sendTelegramMessage = async (chatId, text) => {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
  });
  if (!res.ok) console.log('Telegram delivery error:', await res.text());
};

// ---------- Main handler ----------
module.exports = async (req, res) => {
  try {
    const update = req.body;
    if (!update || !update.message || !update.message.text) {
      return res.status(200).send('OK');
    }

    const msg = update.message;
    const chatId = msg.chat.id;
    const fromUsername = msg.from?.username || '';
    const text = msg.text.trim();
    const userName = msg.from?.first_name || 'Guest Node';

    // 1. Identity detection mapping sensors
    const isNadeem = (chatId === 1123787650 || fromUsername.toLowerCase() === 'nadim4786');

    // 2. Persistent dynamic instruction interceptor loops
    if (isNadeem) {
      const rememberMatch = text.match(/^remember "(.+)"$/);
      if (rememberMatch) {
        const content = rememberMatch[1];
        await supabaseFetch('alex_memory', {
          method: 'POST',
          body: { chat_id: String(chatId), role: 'user_permanent', content }
        });
        await sendTelegramMessage(chatId, `✅ *Memory Locked, Boss!*\n\nSir, maine ye baat permanent database layer me archive kar li hai:\n\`"${content}"\``);
        return res.status(200).send('OK');
      }

      const instructionMatch = text.match(/^instruction:\s*(.+)$/);
      if (instructionMatch) {
        const newPrompt = instructionMatch[1];
        await supabaseFetch('alex_config', {
          method: 'POST',
          body: { key: 'system_prompt', value: `You are Alex, a loyal assistant. Current instructions: ${newPrompt}` }
        });
        await sendTelegramMessage(chatId, `🎯 *System Prompt Updated Instantly, Sir!*\n\nNaye regulations database configurations table me write ho chuke hain, bina code update kiye.`);
        return res.status(200).send('OK');
      }
    }

    if (text === "/start") {
      const startGreeting = isNadeem 
          ? `🤖 *Alex Core Live Build Active!*\n\nWelcome back, Boss. Clean JavaScript parameters, fixed endpoint mapping patterns, and your standard variables are perfectly synced. System conscious.`
          : `🤖 *Alex System Online.*\n\nGreetings! I am Alex, a real-time smart crypto companion. Language mirror filter active. How can I assist you with market variables today?`;
      await sendTelegramMessage(chatId, startGreeting);
      return res.status(200).send('OK');
    }

    // 3. Execution pipeline logic data fetching
    const language = detectLanguage(text);
    const config = await getConfig();
    const prices = await getCryptoPrices();
    const history = await getChatHistory(chatId);

    // Save user incoming payload message to Supabase rolling array
    await saveChatMessage(chatId, 'user', text);

    // Build conscious system parameters context prompt
    const systemPrompt = buildSystemPrompt(config, isNadeem, userName, language, prices);

    // Execute brain transaction matrix
    const alexReply = await callDeepSeek(systemPrompt, history, text);

    // Save assistant reply and trigger outbound delivery
    await saveChatMessage(chatId, 'assistant', alexReply);
    await sendTelegramMessage(chatId, alexReply);

    return res.status(200).send('OK');
  } catch (err) {
    console.log("Master handler loop crash block:", err.message);
    return res.status(200).send('OK');
  }
};
