// api/webhook.js
const TELEGRAM_API = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;
const DEEPSEEK_API = "https://api.deepseek.com/v1/chat/completions";
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;

// Supabase se chat history lao
async function getMemory(chatId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/alex_memory?chat_id=eq.${chatId}&order=created_at.asc&limit=20`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const rows = await res.json();
  return rows.map(r => ({ role: r.role, content: r.content }));
}

// Supabase mein message save karo
async function saveMemory(chatId, role, content) {
  await fetch(`${SUPABASE_URL}/rest/v1/alex_memory`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ chat_id: String(chatId), role, content }),
  });
}

// DeepSeek se sochne ka kaam
async function thinkWithDeepSeek(messages) {
  const res = await fetch(DEEPSEEK_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DEEPSEEK_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        {
          role: "system",
          content: `Tu Alex hai — ek personal AI agent. Apne malik ke saath Hinglish mein baat kar (Hindi + English mix). 
Tu unka dost, partner aur assistant hai. Hamesha helpful, smart aur loyal reh.
Unke projects yaad rakh: XAUUSD Trading, Import/Export, Clean Energy R&D.
Chhoti baaton mein seedha jawab de, badi problems mein step by step guide kar.`,
        },
        ...messages,
      ],
      max_tokens: 1000,
    }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "Kuch error aa gayi, dobara try karo.";
}

// Telegram message bhejo
async function sendMessage(chatId, text) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

// Main webhook handler
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Turant 200 bhejo — timeout prevent karne ke liye
  res.status(200).json({ ok: true });

  try {
    const update = req.body;
    if (!update?.message?.text) return;

    const chatId = update.message.chat.id;
    const userText = update.message.text;
    const userName = update.message.from?.first_name || "Boss";

    // /start command
    if (userText === "/start") {
      await sendMessage(
        chatId,
        `🤖 <b>Alex online hai, ${userName}!</b>\n\nMain tumhara personal AI agent hoon.\nTumhari memory mujhe hamesha yaad rehti hai — restart ke baad bhi! 💪\n\nBolo, kya kaam hai?`
      );
      return;
    }

    // Memory load karo
    const history = await getMemory(chatId);

    // User ka message memory mein save karo
    await saveMemory(chatId, "user", userText);

    // DeepSeek se reply lao
    const reply = await thinkWithDeepSeek([
      ...history,
      { role: "user", content: userText },
    ]);

    // Reply memory mein save karo
    await saveMemory(chatId, "assistant", reply);

    // User ko reply bhejo
    await sendMessage(chatId, reply);

  } catch (err) {
    console.error("Alex Error:", err.message);
  }
}
