// api/webhook.js
// Telegram Bot Webhook — Vercel Serverless Function (Node.js)

const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

/**
 * Telegram ko message bhejne ka helper function
 */
async function sendMessage(chatId, text) {
  const url = `${TELEGRAM_API}/sendMessage`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "HTML",
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Telegram API Error: ${response.status} - ${JSON.stringify(errorData)}`);
  }

  return response.json();
}

/**
 * Bot ki core logic — message ko process karta hai
 */
async function processUpdate(update) {
  if (!update.message || !update.message.text) {
    console.log("Non-text update received, skipping.");
    return;
  }

  const chatId = update.message.chat.id;
  const userText = update.message.text;
  const userName = update.message.from.first_name || update.message.from.username || "User";

  console.log(`Message from ${userName} (${chatId}): "${userText}"`);

  if (userText === "/start") {
    const welcomeMessage = `
🤖 <b>Namaste, ${userName}!</b>

Aapka Bot mein swagat hai! 🎉

Main abhi <b>Echo Mode</b> mein hoon — matlab aap jo bhi message karenge, main wahi wapas bhej doonga.

<b>Available Commands:</b>
/start — Yeh welcome message dobara dekhein

Koi bhi text type karke test karein! ✅
    `.trim();

    await sendMessage(chatId, welcomeMessage);
  } else {
    const echoMessage = `🔁 <b>Echo:</b>\n${userText}`;
    await sendMessage(chatId, echoMessage);
  }
}

/**
 * Main Handler — Vercel is function ko call karta hai
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const update = req.body;

    if (!update || typeof update !== "object") {
      console.error("Invalid update received:", update);
      return res.status(400).json({ error: "Invalid payload" });
    }

    // Pehle message process hoga (Yeh 1-2 second hi leta hai)
    await processUpdate(update);
    
    // Process khatam hone ke baad Telegram ko 200 OK bolo
    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error("❌ Error processing Telegram update:", error.message);
    // Agar koi error aaye toh bhi Telegram ko 200 bhej do taaki wo baar-baar retry na kare
    return res.status(200).json({ ok: true, error: error.message });
  }
}
