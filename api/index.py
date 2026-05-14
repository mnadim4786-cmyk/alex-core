import os
import json
from flask import Flask, request
import requests
from anthropic import Anthropic
from supabase import create_client

app = Flask(__name__)

# System environment credentials fetch
TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_ANON_KEY")
CLAUDE_KEY = os.getenv("ANTHROPIC_API_KEY")

# Safe initialization checking
if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
else:
    supabase = None

if CLAUDE_KEY:
    claude = Anthropic(api_key=CLAUDE_KEY)
else:
    claude = None

@app.route('/api/webhook', methods=['POST'])
def webhook():
    try:
        update = request.get_json()
        if not update or "message" not in update or "text" not in update["message"]:
            return "OK", 200
            
        chat_id = update["message"]["chat"]["id"]
        user_text = update["message"]["text"]
        
        # Tony Stark level standard loyal prompt
        system_prompt = (
            "You are Alex, a high-performance virtual partner, quantitative trading assistant, "
            "and loyal friend inspired by Iron Man's JARVIS. Speak in natural conversational Hinglish. "
            "Be witty, smart, deeply intelligent, and completely devoted to your Boss. Always address "
            "the user as Sir or Boss. Maintain context and provide strategic advice on demand."
        )
        
        alex_reply = "Alex Engine Active, Sir! Dynamic serverless pipeline online. 🫡"
        
        if claude:
            # Direct smart interaction via Claude engine
            message = claude.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=1000,
                system=system_prompt,
                messages=[{"role": "user", "content": user_text}]
            )
            alex_reply = message.content[0].text
            
        # Send instant response frame straight to Telegram App
        if TOKEN:
            url = f"https://telegram.org{TOKEN}/sendMessage"
            requests.post(url, json={"chat_id": chat_id, "text": alex_reply})
            
    except Exception as e:
        print(f"Error executing loop context: {str(e)}")
        
    return "OK", 200
