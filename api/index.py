import os
import json
import logging
import requests
from flask import Flask, request, jsonify

logging.basicConfig(level=logging.INFO, format='%(asctime)s - [ALEX-CORE] - %(levelname)s - %(message)s')
app = Flask(__name__)

TELEGRAM_TOKEN = os.environ.get("TELEGRAM_TOKEN")
CLAUDE_API_KEY = os.environ.get("CLAUDE_API_KEY")
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY")

TELEGRAM_URL = f"https://telegram.org{TELEGRAM_TOKEN}/sendMessage"

def clean_markdown(text):
    """Failsafe: Telegram strict markdown parsing errors se bachne ke liye generic escaping."""
    # Agar parse_mode Markdown hai, toh unclosed special characters message block destroy kar dete hain
    replacements = {"_": "\\_", "*": "\\*", "`": "\\`", "[": "\\["}
    for target, replacement in replacements.items():
        text = text.replace(target, replacement)
    return text

def reach_telegram(chat_id, text_content):
    """Outgoing Layer validation with aggressive debugging logs."""
    payload = {
        "chat_id": chat_id,
        "text": text_content,
        "parse_mode": "Markdown"
    }
    
    try:
        logging.info(f"🚀 Outgoing Telegram Payload Verification: {json.dumps(payload)}")
        # Timeout strictly at 4 seconds to protect Vercel 10s execution cap
        response = requests.post(TELEGRAM_URL, json=payload, timeout=4)
        
        logging.info(f"📡 Telegram Server Reply Status Code: {response.status_code}")
        logging.info(f"📡 Telegram Response Body Raw Data: {response.text}")
        
        if response.status_code != 200:
            logging.warning("⚠️ High Alert: Telegram rejected payload! Trying fallback without Markdown formatting...")
            payload.pop("parse_mode", None)
            fallback_res = requests.post(TELEGRAM_URL, json=payload, timeout=4)
            logging.info(f"🔄 Fallback Plain-Text Status: {fallback_res.status_code}")
            return fallback_res.status_code == 200
            
        return True
    except Exception as network_error:
        logging.error(f"🚨 Network layer crash during Telegram handshake: {str(network_error)}")
        return False

@app.route('/', defaults={'path': ''}, methods=['POST', 'GET'])
@app.route('/<path:path>', methods=['POST', 'GET'])
def alex_handler(path):
    if request.method == 'GET':
        return jsonify({"status": "active", "identity": "Alex JARVIS Core"}), 200

    # Step 1: Telegram webhook validation payload capture
    try:
        incoming_data = request.get_json(force=True)
        logging.info(f"📥 Incoming Payload From Telegram: {json.dumps(incoming_data)}")
    except Exception as parse_err:
        logging.error(f"❌ Failed processing inbound JSON architecture: {str(parse_err)}")
        return jsonify({"status": "failed_json_parse"}), 200

    message_object = incoming_data.get("message", {})
    chat_metadata = message_object.get("chat", {})
    chat_id = chat_metadata.get("id")
    user_query = message_object.get("text", "")

    if not chat_id:
        logging.warning("❌ Target structural mapping skipped: chat_id not found inside JSON scope.")
        return jsonify({"status": "skipped_no_chat"}), 200

    if not user_query:
        logging.info("ℹ️ System skipped content processing: Payload is structural metadata or non-text frame.")
        return jsonify({"status": "skipped_empty_body"}), 200

    # Step 2: Environment verification systems execution check
    if not TELEGRAM_TOKEN or not CLAUDE_API_KEY:
        error_msg = "⚠️ Core Initialization Blocked: Environment tokens are structurally missing or corrupted inside Vercel."
        logging.critical(error_msg)
        reach_telegram(chat_id, error_msg)
        return jsonify({"status": "missing_token_architecture"}), 200

    # Step 3: LLM request tracking block (Temporary diagnostic trace wrapper)
    try:
        logging.info(f"⚡ Processing core matrix routing for Boss. Content size: {len(user_query)} chars.")
        
        # NOTE: Apne Anthropic/DeepSeek call parameters me strict timeout=4 add kijiye!
        # Agar LLM server response time delay karega, toh Vercel code pipeline ko block kar dega.
        
        diagnostic_echo = f"⚡ *Alex Online System Test*:\n\nSir, humara routing matrix bilkul responsive hai. Received command: `{clean_markdown(user_query)}`.\n\nOutgoing handshake processing clear hai."
        
        delivery_status = reach_telegram(chat_id, diagnostic_echo)
        if delivery_status:
            logging.info("✅ Core Transaction Successful: Outbound packets delivered back to Telegram node.")
        else:
            logging.error("❌ Core System Failure: Final handshaking framework declined entry.")
            
    except Exception as internal_pipeline_crash:
        error_tracking = f"💥 Critical Pipeline Crash detected inside core runtime: {str(internal_pipeline_crash)}"
        logging.error(error_tracking)
        reach_telegram(chat_id, f"🚨 *System Exception Trace*:\n`{error_tracking}`")

    return jsonify({"status": "matrix_execution_complete"}), 200
