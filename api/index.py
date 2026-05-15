import os
import json
import logging
import requests
from flask import Flask, request, jsonify

logging.basicConfig(level=logging.INFO, format='%(asctime)s - [ALEX-CORE] - %(levelname)s - %(message)s')
app = Flask(__name__)

# 1. PERMANENT TELEGRAM ROUTE
TELEGRAM_URL = "https://telegram.org"

# 2. BOSS KI PERSONAL ID HARDCODED (Ab scan karne ki zaroorat nahi)
BOSS_CHAT_ID = 1123787650

def reach_telegram(text_content):
    """Direct transmission engine targeted ONLY to Boss chat ID."""
    payload = {
        "chat_id": BOSS_CHAT_ID,  # Direct aapki ID par message jayega
        "text": text_content
    }
    try:
        logging.info(f"🚀 Outgoing Pure Payload: {json.dumps(payload)}")
        response = requests.post(TELEGRAM_URL, json=payload, timeout=4)
        logging.info(f"📡 Status Code: {response.status_code} | Body: {response.text}")
        return response.status_code == 200
    except Exception as e:
        logging.error(f"🚨 Outbound network crash: {str(e)}")
        return False

@app.route('/api/webhook', methods=['POST', 'GET'])
@app.route('/', defaults={'path': ''}, methods=['POST', 'GET'])
@app.route('/<path:path>', methods=['POST', 'GET'])
def alex_handler(path=None):
    if request.method == 'GET':
        return jsonify({"status": "active", "identity": "Alex JARVIS Core"}), 200

    try:
        incoming_data = request.get_json(force=True)
        logging.info(f"📥 Received Payload: {json.dumps(incoming_data)}")
    except Exception as parse_err:
        return jsonify({"status": "failed_json_parse"}), 200

    # Jab bhi koi bhi update aayegi, system seedha aapki ID par response fire karega
    try:
        diagnostic_text = "Alex Status Update: Sir, static routing engine completely locked onto your personal Chat ID! Connection secure."
        reach_telegram(diagnostic_text)
    except Exception as internal_pipeline_crash:
        logging.error(f"💥 Internal Crash: {str(internal_pipeline_crash)}")

    return jsonify({"status": "matrix_execution_complete"}), 200
