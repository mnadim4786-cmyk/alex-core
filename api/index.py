import os
import requests
from flask import Flask, request

app = Flask(__name__)

TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
CLAUDE_KEY = os.getenv("ANTHROPIC_API_KEY")

@app.route('/api/webhook', methods=['POST', 'GET'])
def webhook():
    if request.method == 'GET':
        return "Alex Engine Online", 200
        
    try:
        update = request.get_json()
        if update and "message" in update and "text" in update["message"]:
            chat_id = update["message"]["chat"]["id"]
            user_text = update["message"]["text"]
            
            # Default response framework
            alex_reply = "Alex JARVIS Online, Sir! Dynamic communication network locked. 🫡"
            
            if CLAUDE_KEY:
                # Direct HTTP Request to Claude API (Bypassing standard SDK leaks)
                headers = {
                    "x-api-key": CLAUDE_KEY,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json"
                }
                data = {
                    "model": "claude-3-5-sonnet-latest",
                    "max_tokens": 1024,
                    "system": "You are Alex, a witty Hinglish quantitative trading assistant and loyal JARVIS friend. Always address the user as Sir or Boss.",
                    "messages": [{"role": "user", "content": user_text}]
                }
                
                response = requests.post("https://anthropic.com", json=data, headers=headers)
                if response.status_code == 200:
                    alex_reply = response.json()["content"][0]["text"]
            
            if TOKEN:
                requests.post(f"https://telegram.org{TOKEN}/sendMessage", json={"chat_id": chat_id, "text": alex_reply})
                
    except Exception as e:
        print(f"Server loop error: {str(e)}")
        
    return "OK", 200

application = app
