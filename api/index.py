import os
import json
import logging
import requests
from flask import Flask, request, jsonify

logging.basicConfig(level=logging.INFO, format='%(asctime)s - [ALEX-CORE] - %(levelname)s - %(message)s')
app = Flask(__name__)

# Exact match with your Vercel Environment Variables Screenshot
TELEGRAM_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")  # Changed from TELEGRAM_TOKEN
CLAUDE_API_KEY = os.environ.get("ANTHROPIC_API_KEY")   # Changed from CLAUDE_API_KEY
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY")

TELEGRAM_URL = f"https://telegram.org{TELEGRAM_TOKEN}/sendMessage"

def clean_markdown(text):
    replacements = {"_": "\\_", "*": "\\*", "`": "\\`", "[": "\\["}
    for target, replacement in replacements.items():
        text = text.replace(target, replacement)
    return text

def reach_telegram(chat_id, text_content):
    payload = {
        "chat_id": chat_id,
        "text": text_content,
        "parse_mode": "Markdown"
    }
    try:
        logging.info(f"🚀 Outgoing Payload: {json.dumps(payload)}")
        response = requests.post(TELEGRAM_URL, json=payload, timeout=4)
        logging.info(f"📡 Status Code: {response.status_code} | Body: {response.text}")
        
        if response.status_code != 200:
            payload.pop("parse_mode", None)
            fallback_res = requests.post(TELEGRAM_URL, json=payload, timeout=4)
            return fallback_res.status_code == 200
        return True
    except Exception as e:
        logging.error(f"🚨 Network Exception: {str(e)}")
        return False

@app.route('/api/webhook', methods=['POST', 'GET'])
@app.route('/', defaults={'path': ''}, methods=['POST', 'GET'])
@app.route('/<path:path>', methods=['POST', 'GET'])
def alex_handler(path=None):
    if request.method == 'GET':
        return jsonify({"status": "active", "identity": "Alex JARVIS Core"}), 200

    try:
        incoming_data = request.get_json(force=True)
        logging.info(f"📥 Received Target Data: {json.dumps(incoming_data)}")
    except Exception as parse_err:
        logging.error(f"❌ JSON Parse Error: {str(parse_err)}")
        return jsonify({"status": "failed_json_parse"}), 200

    message_object = incoming_data.get("message", {})
    chat_metadata = message_object.get("chat", {})
    chat_id = chat_metadata.get("id")
    user_query = message_object.get("text", "")

    if not chat_id:
        return jsonify({"status": "skipped_no_chat"}), 200

    if not user_query:
        return jsonify({"status": "skipped_empty_body"}), 200

    if not TELEGRAM_TOKEN:
        logging.critical("❌ TELEGRAM_BOT_TOKEN is still missing in Vercel Env Vars!")
        return jsonify({"status": "missing_token"}), 200

    try:
        diagnostic_echo = f"⚡ *Alex System Restructured Successfully!*\n\nSir, direct explicit path mapping `/api/webhook` aur key sync dono activate ho chuki hain.\nReceived command: `{clean_markdown(user_query)}`"
        reach_telegram(chat_id, diagnostic_echo)
    except Exception as internal_pipeline_crash:
        logging.error(f"💥 Internal Crash: {str(internal_pipeline_crash)}")

    return jsonify({"status": "matrix_execution_complete"}), 200
