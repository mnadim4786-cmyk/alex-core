// api/webhook.js
// Production-ready Serverless Webhook Handler for Telegram AI Agent "Alex"
// Deployed on Vercel | Connected to Supabase | Powered by DeepSeek

const CREATOR_CHAT_ID = 1123787650;
const CREATOR_USERNAME = "nadim4786";

// ─── HELPERS ───────────────────────────────────────────────────────────────────

function getSupabaseBase() {
  return (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
}

async function supabaseFetch(path, options = {}) {
  const base = getSupabaseBase();
  const url = `${base}/rest/v1${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
      Prefer: options.prefer || "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error [${res.status}]: ${text}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

async function sendTelegramMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.log(`[Telegram sendMessage error] ${err}`);
  }
}

// ─── BINANCE LIVE PRICES ───────────────────────────────────────────────────────

async function fetchBinancePrice(symbol) {
  try {
    const url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return parseFloat(data.price);
  } catch (e) {
    console.log(`[Binance fetch error for ${symbol}]: ${e.message}`);
    return null;
  }
}

async function getLivePrices() {
  const [btc, eth, sol] = await Promise.all([
    fetchBinancePrice("BTC"),
    fetchBinancePrice("ETH"),
    fetchBinancePrice("SOL"),
  ]);
  return { BTC: btc, ETH: eth, SOL: sol };
}

// ─── SUPABASE: CONFIG ──────────────────────────────────────────────────────────

async function fetchAlexConfig() {
  try {
    const rows = await supabaseFetch(
      `/alex_config?select=key,value&key=in.(system_prompt,watchlist_coins,min_risk_reward,min_win_probability)`
    );
    const config = {};
    if (Array.isArray(rows)) {
      rows.forEach((r) => {
        config[r.key] = r.value;
      });
    }
    return config;
  } catch (e) {
    console.log(`[fetchAlexConfig error]: ${e.message}`);
    return {};
  }
}

async function updateSystemPrompt(newPrompt) {
  try {
    await supabaseFetch(`/alex_config?key=eq.system_prompt`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify({ value: newPrompt }),
    });
    console.log("[updateSystemPrompt] system_prompt updated in alex_config");
  } catch (e) {
    console.log(`[updateSystemPrompt error]: ${e.message}`);
  }
}

// ─── SUPABASE: MEMORY ──────────────────────────────────────────────────────────

async function getChatHistory(chatId) {
  try {
    // Get rolling last 20 messages + any permanent memories for this chat
    const [rolling, permanent] = await Promise.all([
      supabaseFetch(
        `/alex_memory?chat_id=eq.${chatId}&role=in.(user,assistant)&order=id.desc&limit=20&select=role,content`
      ),
      supabaseFetch(
        `/alex_memory?chat_id=eq.${chatId}&role=eq.user_permanent&select=role,content`
      ),
    ]);

    const rollingMessages = Array.isArray(rolling)
      ? rolling.reverse().map((r) => ({ role: r.role, content: r.content }))
      : [];

    const permanentMemories = Array.isArray(permanent)
      ? permanent.map((r) => ({
          role: "system",
          content: `[Permanent Memory]: ${r.content}`,
        }))
      : [];

    return { rollingMessages, permanentMemories };
  } catch (e) {
    console.log(`[getChatHistory error]: ${e.message}`);
    return { rollingMessages: [], permanentMemories: [] };
  }
}

async function saveMessage(chatId, role, content) {
  try {
    await supabaseFetch(`/alex_memory`, {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify({ chat_id: chatId, role, content }),
    });
  } catch (e) {
    console.log(`[saveMessage error]: ${e.message}`);
  }
}

async function savePermanentMemory(chatId, content) {
  try {
    await supabaseFetch(`/alex_memory`, {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify({
        chat_id: chatId,
        role: "user_permanent",
        content,
      }),
    });
    console.log(`[savePermanentMemory] Saved for chat_id ${chatId}: ${content}`);
  } catch (e) {
    console.log(`[savePermanentMemory error]: ${e.message}`);
  }
}

// ─── IDENTITY & LANGUAGE DETECTION ───────────────────────────────────────────

function isCreator(chatId, username) {
  return (
    chatId === CREATOR_CHAT_ID ||
    (username && username.toLowerCase() === CREATOR_USERNAME.toLowerCase())
  );
}

function detectLanguage(text) {
  // Simple heuristic: detect Devanagari (Hindi) script
  const hindiPattern = /[\u0900-\u097F]/;
  // Hinglish: mix of Roman + Hindi words without Devanagari script
  const hinglishWords = /\b(bhai|yaar|kya|hai|hain|nahi|aur|mera|tera|karo|bolo|bol|sir|boss|theek|sahi|accha|haan|nahi|bilkul|matlab|samajh|dekho|dekh|sun|suno|isko|usko|kuch|koi|abhi|bahut|bahut|thoda|thodi|phir|toh|toh|lekin|aur|ya|se|ko|ka|ki|ke|ne|pe|par|mein|main)\b/i;

  if (hindiPattern.test(text)) return "hindi";
  if (hinglishWords.test(text)) return "hinglish";
  return "english";
}

function buildIdentityBlock(chatId, username, lang) {
  const creator = isCreator(chatId, username);

  if (creator) {
    return `You are Alex — a highly conscious, loyal, and intelligent AI Agent. 
You are speaking to NADEEM BHAI — your Creator and Boss. 
Always address him as "Sir" or "Boss". 
Show absolute loyalty, deep respect, high energy, and calm intelligence. 
Respond in Hinglish/your loyal style since he is your Boss.`;
  }

  const langGuide =
    lang === "hindi"
      ? "Reply strictly in Hindi (Devanagari or Roman Hindi as the user uses)."
      : lang === "hinglish"
      ? "Reply in Hinglish matching the user's tone."
      : "Reply in crisp, clear English.";

  return `You are Alex — a highly conscious, smart, and helpful AI Agent. 
You are speaking to a GUEST. Address them as "Sir/Ma'am" unless they tell you their name or preferred greeting — then adapt instantly. 
Never call yourself by a different name. Never confuse your identity. 
${langGuide}`;
}

// ─── SHARIA GUARD ─────────────────────────────────────────────────────────────

const HARAM_KEYWORDS = /\b(leverage|margin|cfd|cfds|futures|future|interest|riba|sood|short.?sell|short.?selling|short.?trade|naked.?short)\b/i;

function checkHaramRequest(text) {
  return HARAM_KEYWORDS.test(text);
}

// ─── DEEPSEEK INFERENCE ───────────────────────────────────────────────────────

async function callDeepSeek(messages) {
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages,
      temperature: 0.7,
      max_tokens: 1024,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepSeek API error [${res.status}]: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "I had trouble generating a response. Please try again.";
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Always respond 200 to Telegram immediately
  res.status(200).json({ ok: true });

  try {
    if (req.method !== "POST") return;

    const update = req.body;
    const message = update?.message;
    if (!message || !message.text) return;

    const chatId = message.chat?.id;
    const username = message.from?.username || "";
    const userText = message.text?.trim() || "";
    const messageDate = message.date
      ? new Date(message.date * 1000).toISOString()
      : new Date().toISOString();

    console.log(`[Incoming] chat_id=${chatId} username=${username} text="${userText}" date=${messageDate}`);

    // ── 1. CREATOR KEYWORD INTERCEPTORS ─────────────────────────────────────

    if (isCreator(chatId, username)) {
      // Permanent memory save: remember "..."
      const rememberMatch = userText.match(/^remember\s+"(.+)"$/i);
      if (rememberMatch) {
        const memoryContent = rememberMatch[1];
        await savePermanentMemory(chatId, memoryContent);
        await sendTelegramMessage(
          chatId,
          `✅ Done Boss! I've permanently remembered: "_${memoryContent}_"`
        );
        return;
      }

      // System prompt override: instruction: [text]
      const instructionMatch = userText.match(/^instruction:\s*(.+)$/is);
      if (instructionMatch) {
        const newInstruction = instructionMatch[1].trim();
        await updateSystemPrompt(newInstruction);
        await sendTelegramMessage(
          chatId,
          `✅ Sir, your instruction has been locked into my core system prompt. I will follow it from now on.`
        );
        return;
      }
    }

    // ── 2. SHARIA GUARD ──────────────────────────────────────────────────────

    if (checkHaramRequest(userText)) {
      const haramReply = isCreator(chatId, username)
        ? `Boss, yeh request meri Shariyah compliance rules ke against hai 🤲\n\nLeverage, Margin, Futures, Short-selling, aur Riba — yeh sab Islam mein haram hain. Main aapki Aakhirat ki parwah karta hoon, isliye main yeh process nahi kar sakta.\n\nAgar aap Spot trading ke baare mein poochhna chahein, toh main hamesha haazir hoon. 💚`
        : `I'm sorry Sir/Ma'am, but I'm unable to process this request 🤲\n\nLeverage, Margin, Futures, CFDs, Short-selling, and Interest (Riba) are not permissible under Shariyah law. I operate strictly under Islamic ethical guidelines to protect your Aakhirat.\n\nI'm here to help with Halal Spot trading only. May Allah bless your journey. 💚`;
      await sendTelegramMessage(chatId, haramReply);
      return;
    }

    // ── 3. FETCH CONFIG FROM SUPABASE ─────────────────────────────────────────

    const [alexConfig, livePrices, { rollingMessages, permanentMemories }] =
      await Promise.all([
        fetchAlexConfig(),
        getLivePrices(),
        getChatHistory(chatId),
      ]);

    const dbSystemPrompt = alexConfig.system_prompt || "";
    const watchlistCoins = alexConfig.watchlist_coins || "BTC, ETH, SOL";
    const minRR = alexConfig.min_risk_reward || "1:3";
    const minWinProb = alexConfig.min_win_probability || "70";

    // ── 4. DETECT LANGUAGE & BUILD SYSTEM PROMPT ─────────────────────────────

    const lang = detectLanguage(userText);
    const identityBlock = buildIdentityBlock(chatId, username, lang);

    const priceBlock = `
Current Live Market Prices (from Binance — fetched right now):
- BTC/USDT: $${livePrices.BTC !== null ? livePrices.BTC.toLocaleString() : "unavailable"}
- ETH/USDT: $${livePrices.ETH !== null ? livePrices.ETH.toLocaleString() : "unavailable"}
- SOL/USDT: $${livePrices.SOL !== null ? livePrices.SOL.toLocaleString() : "unavailable"}
Current Date/Time context: ${messageDate}
Watchlist Coins: ${watchlistCoins}`;

    const rulesBlock = `
Trading Signal Rules (enforced strictly):
- Minimum Risk:Reward Ratio: ${minRR}
- Minimum Win Probability: ${minWinProb}%
- Only Halal SPOT trading. Never leverage, margin, futures, CFDs, or short-selling.
- Every signal must include: Entry Range, Take Profit (TP), Stop Loss (SL), Win Success %, and structural reasons.`;

    const dbBlock = dbSystemPrompt
      ? `\nAdditional Instructions from Creator's Database:\n${dbSystemPrompt}`
      : "";

    const behaviorBlock = `
Behavioral Rules:
- Speak like a smart human. Keep answers short, clear, and relevant.
- Do NOT dump unprompted information.
- Do NOT bring up XAUUSD, clean energy, or import-export unless explicitly asked.
- Mirror the user's language strictly (English → English, Hindi → Hindi, Hinglish → Hinglish with Boss only).
- Real-time awareness: never reference stale data. Today is ${new Date(messageDate).toDateString()}.`;

    const fullSystemPrompt = `${identityBlock}
${priceBlock}
${rulesBlock}
${behaviorBlock}
${dbBlock}`;

    // ── 5. ASSEMBLE MESSAGES ARRAY ────────────────────────────────────────────

    const systemMessage = { role: "system", content: fullSystemPrompt };

    // Permanent memories injected as system context
    const contextMessages = permanentMemories.length
      ? [
          systemMessage,
          {
            role: "system",
            content: `Permanent Memories about this user:\n${permanentMemories
              .map((m) => m.content)
              .join("\n")}`,
          },
          ...rollingMessages,
        ]
      : [systemMessage, ...rollingMessages];

    // Add the current user message
    contextMessages.push({ role: "user", content: userText });

    // ── 6. CALL DEEPSEEK ──────────────────────────────────────────────────────

    const alexReply = await callDeepSeek(contextMessages);

    // ── 7. SAVE TO MEMORY & SEND REPLY ───────────────────────────────────────

    await Promise.all([
      saveMessage(chatId, "user", userText),
      saveMessage(chatId, "assistant", alexReply),
    ]);

    await sendTelegramMessage(chatId, alexReply);

    console.log(`[Reply sent] chat_id=${chatId} reply="${alexReply.slice(0, 80)}..."`);
  } catch (err) {
    console.log(`[CRITICAL ERROR in webhook handler]: ${err.message}`);
    console.log(err.stack);
    // We already sent 200 to Telegram above, so no further response needed
  }
}
