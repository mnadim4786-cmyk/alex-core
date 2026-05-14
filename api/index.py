import os
from flask import Flask, request
import requests
from anthropic import Anthropic

app = Flask(__name__)

TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
CLAUDE_KEY = os.getenv("ANTHROPIC_API_KEY")

claude = Anthropic(api_key=CLAUDE_KEY) if CLAUDE_KEY else None

@app.route('/api/webhook', methods=['POST', 'GET'])
def webhook():
    if request.method == 'GET':
        return "Alex Engine Online", 200
        
    try:
        update = request.get_json()
        if update and "message" in update and "text" in update["message"]:
            chat_id = update["message"]["chat"]["id"]
            user_text = update["message"]["text"]
            
            system_prompt = (
                "You are Alex, a high-performance virtual partner, quantitative trading assistant, "
                "and loyal friend inspired by Iron Man's JARVIS. Speak in natural conversational Hinglish. "
                "Be witty, smart, deeply intelligent, and completely devoted to your Boss. Always address "
                "the user as Sir or Boss."
            )
            alex_reply = "Alex Engine Active, Sir! Connection locked via Vercel pipeline. 🫡"
            
            if claude:
                message = claude.messages.create(
                    model="claude-3-5-sonnet-20241022",
                    max_tokens=1000,
                    system=system_prompt,
                    messages=[{"role": "user", "content": user_text}]
                )
                alex_reply = message.content.text
                
            if TOKEN:
                requests.post(f"https://telegram.org{TOKEN}/sendMessage", json={"chat_id": chat_id, "text": alex_reply})
    except Exception as e:
        print(f"Error: {str(e)}")
        
    return "OK", 200

application = app
