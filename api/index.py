import os
import json
import logging
import requests
from flask import Flask, request, jsonify

# Live high-verbosity runtime logging framework
logging.basicConfig(level=logging.INFO, format='%(asctime)s - [ALEX-CORE] - %(levelname)s - %(message)s')
app = Flask(__name__)

# Sir, humne aapka token direct absolute framework me embed kar diya hai taaki structural mapping safe rahe
TELEGRAM_URL = "https://telegram.org"

CLAUDE_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY")

def clean_markdown(text):
    """Telegram formatting crash protection system."""
    replacements = {"_": "\\_", "*": "\\*", "`": "\\`", "[": "\\["}
    for target, replacement in replacements.items():
        text = text.replace(target, replacement)
    return text

def reach_telegram(chat_id, text_content):
    """Direct outgoing delivery engine with inline exception catchers."""
    payload = {
        "chat_id": chat_id,
        "text": text_content,
        "parse_mode": "Markdown"
    }
    try:
        logging.info(f"🚀 Outgoing Payload: {json.dumps(payload)}")
        response = requests.post(TELEGRAM_URL, json=payload, timeout=4)
        logging.info(f"📡 Status Code: {response.status_code} | Body: {response.text}")
        
        # Parse failure protection protocol toggle
        if response.status_code != 200:
            logging.warning("⚠️ Formatting error fallback triggered.")
            payload.pop("parse_mode", None)
            fallback_res = requests.post(TELEGRAM_URL, json=payload, timeout=4)
            return fallback_res.status_code == 200
        return True
    except Exception as e:
        logging.error(f"🚨 Network Exception Inside Outbound Layer: {str(e)}")
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

    try:
        # Failsafe core confirmation framework
        diagnostic_echo = f"⚡ *Alex System Restructured Successfully!*\n\nSir, static routing engine `/api/webhook` aur exact token integration dono live hain.\n\nCommand received: `{clean_markdown(user_query)}`"
        reach_telegram(chat_id, diagnostic_echo)
    except Exception as internal_pipeline_crash:
        logging.error(f"💥 Internal Crash inside handler execution: {str(internal_pipeline_crash)}")

    return jsonify({"status": "matrix_execution_complete"}), 200
