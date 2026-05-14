import os
import json
from flask import Flask, request
import requests
from anthropic import Anthropic

app = Flask(__name__)

TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
CLAUDE_KEY = os.getenv("ANTHROPIC_API_KEY")

if CLAUDE_KEY:
    claude = Anthropic(api_key=CLAUDE_KEY)
else:
    claude = None

@app.route('/api/webhook', methods=['POST', 'GET'])
def webhook():
    if request.method == 'GET':
        return "Alex Engine Serverless Active", 200
        
    try:
        update = request.get_json()
        if update and "message" in update and "text" in update["message"]:
            chat_id = update["message"]["chat"]["id"]
            user_text = update["message"]["text"]
            
            system_prompt = "You are Alex, a witty Hinglish quantitative trading assistant and loyal JARVIS friend."
            alex_reply = "Alex Live, Sir! Connection locked via Vercel pipeline. 🫡"
            
            if claude:
                message = claude.messages.create(
                    model="claude-3-5-sonnet-20241022",
                    max_tokens=1000,
                    system=system_prompt,
                    messages=[{"role": "user", "content": user_text}]
                )
                alex_reply = message.content.text
                
            if TOKEN:
                url = f"https://telegram.org{TOKEN}/sendMessage"
                requests.post(url, json={"chat_id": chat_id, "text": alex_reply})
    except Exception as e:
        print(f"Error: {str(e)}")
        
    return "OK", 200

# Vercel infrastructure handle connection entry point
application = app
