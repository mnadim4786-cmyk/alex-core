import os
import requests
from flask import Flask, request, jsonify

app = Flask(__name__)

# Environment Variables se keys uthana
BOT_TOKEN = os.environ.get("BOT_TOKEN")
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY")
TELEGRAM_API = f"https://telegram.org{BOT_TOKEN}"

def send_message(chat_id, text):
    url = f"{TELEGRAM_API}/sendMessage"
    payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
    requests.post(url, json=payload)

def get_ai_reply(user_text):
    # DeepSeek API call karne ka logic
    if not DEEPSEEK_API_KEY:
        return "DeepSeek API key missing in Vercel settings!"
    try:
        url = "https://deepseek.com"
        headers = {"Authorization": f"Bearer {DEEPSEEK_API_KEY}", "Content-Type": "application/json"}
        data = {
            "model": "deepseek-chat",
            "messages": [{"role": "user", "content": user_text}]
        }
        response = requests.post(url, json=data, headers=headers, timeout=10)
        return response.json()['choices'][0]['message']['content']
    except Exception as e:
        return f"AI Error: {str(e)}"

@app.route('/api/webhook', methods=['POST'])
@app.route('/api/index', methods=['POST'])
def webhook():
    update = request.get_json()
    
    if update and "message" in update and "text" in update["message"]:
        chat_id = update["message"]["chat"]["id"]
        user_text = update["message"]["text"]
        
        if user_text == "/start":
            send_message(chat_id, "🤖 Namaste! Main DeepSeek AI Bot hoon. Puchiye aapko kya puchna hai!")
        else:
            # AI se answer lekar user ko reply bhejna
            ai_response = get_ai_reply(user_text)
            send_message(chat_id, ai_response)
            
    return jsonify({"ok": True}), 200

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def catch_all(path):
    return jsonify({"status": "Server running successfully"}), 200
