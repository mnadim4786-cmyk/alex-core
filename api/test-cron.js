// api/test-cron.js — Simple connection test
// Delete this file after testing is done

const BOT_TOKEN = process.env.BOT_TOKEN;
const NADEEM_CHAT_ID = 1123787650;

module.exports = async (req, res) => {
  try {
    const url = "https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage";
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: NADEEM_CHAT_ID,
        text: "✅ *Alex Test Message*\n\nBoss, cron connection working hai!\n\nTime: " + new Date().toISOString(),
        parse_mode: 'Markdown'
      })
    });

    const data = await response.json();
    
    if (data.ok) {
      return res.status(200).json({ success: true, message: "Telegram message sent!" });
    } else {
      return res.status(200).json({ success: false, error: data });
    }
  } catch (err) {
    return res.status(200).json({ success: false, error: err.message });
  }
};
