const TELEGRAM_API = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;
const DEEPSEEK_API = "https://api.deepseek.com/v1/chat/completions";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;

async function getMemory(chatId) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/alex_memory?chat_id=eq.${chatId}&order=created_at.asc&limit=20`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );
    const rows = await res.json();
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => ({ role: r.role, content: r.content }));
  } catch (e) {
    console.log("Memory fetch error:", e.message);
    return [];
  }
}

async function saveMemory(chatId, role, content) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/alex_memory`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        chat_id: String(chatId),
        role: role,
        content: content,
      }),
    });
  } catch (e) {
    console.log("Memory save error:", e.message);
  }
}

async function getAIReply(messages) {
  try {
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
            content: `Tu Alex hai — ek personal AI agent aur dost.
Apne malik ke saath Hinglish mein baat kar (Hindi + English mix).
Tu unka trusted partner hai — hamesha helpful, smart aur loyal reh.
Unke teen bade projects hain:
1. XAUUSD Gold Trading
2. International Import/Export Business  
3. Clean Energy R&D
Chhote sawaalon ka seedha jawab de.
Badi problems mein step by step guide kar.
Kabhi mat bhool ki tu sirf ek tool nahi — tu Alex hai, unka agent.`,
          },
          ...messages,
        ],
        max_tokens: 1000,
        temperature: 0.7,
      }),
    });
    const data = await res.json();
    console.log("DeepSeek response:", JSON.stringify(data));
    if (data.choices && data.choices[0]) {
      return data.choices[0].message.content;
    }
    return "Kuch error aayi, dobara try karo.";
  } catch (e) {
    console.log("AI error:", e.message);
    return "AI se connect nahi ho paya, thodi der baad try karo.";
  }
}

async function sendMessage(chatId, text) {
  try {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: "HTML",
      }),
    });
  } catch (e) {
    console.log("Send message error:", e.message);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  res.status(200).json({ ok: true });

  try {
    const update = req.body;

    if (!update || !update.message || !update.message.text) {
      return;
    }

    const chatId = update.message.chat.id;
    const userText = update.message.text;
    const userName = update.message.from?.first_name || "Boss";

    console.log(`Message from ${userName}: ${userText}`);

    if (userText === "/start") {
      await sendMessage(
        chatId,
        `🤖 <b>Alex online hai, ${userName}!</b>\n\nMain tumhara personal AI agent hoon.\nMeri memory permanent hai — restart ke baad bhi sab yaad rehta hai! 💪\n\nBolo, kya kaam hai?`
      );
      return;
    }

    const history = await getMemory(chatId);
    await saveMemory(chatId, "user", userText);
    const reply = await getAIReply([
      ...history,
      { role: "user", content: userText },
    ]);
    await saveMemory(chatId, "assistant", reply);
    await sendMessage(chatId, reply);
  } catch (err) {
    console.log("Main handler error:", err.message);
  }
};
