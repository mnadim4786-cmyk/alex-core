import os
import json
from flask import Flask, request
import requests
from anthropic import Anthropic
from supabase import create_client

app = Flask(__name__)

# Keys Injection from Vercel Settings
TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_ANON_KEY")
CLAUDE_KEY = os.getenv("ANTHROPIC_API_KEY")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
claude = Anthropic(api_key=CLAUDE_KEY)

@app.route('/api/webhook', methods=['POST'])
def webhook():
    update = request.get_json()
    if "message" in update and "text" in update["message"]:
        chat_id = update["message"]["chat"]["id"]
        user_text = update["message"]["text"]
        
        # 1. Fetch Permanent Memory from Supabase Vault
        # 2. Process Dialogue via Claude Engine (Tony Stark Level Personality)
        alex_reply = "Aapka Jarvis active hai, Sir! Vercel aur Supabase connection loop locked hai. 🫡"
        
        # 3. Send Message back to Telegram
        url = f"https://telegram.org{TOKEN}/sendMessage"
        requests.post(url, json={"chat_id": chat_id, "text": alex_reply})
        
    return "OK", 200
