# OpenAI Realtime API Voice Assistant

This project implements an AI-powered inbound call agent for The Codebender. It uses OpenAI's new realtime API and integrates with Twilio to handle incoming phone calls.

## Features

- Handles incoming calls using Twilio's voice services
- Utilizes OpenAI's realtime API for natural language processing
- Transcribes user speech and generates AI responses in real-time
- Extracts customer details from the conversation
- Sends extracted information to a webhook for further processing
- Call timeouts after 5 minutes
- Use function call to end the call after bidding the customer farewell

## Technologies Used

- Node.js
- Fastify (web framework)
- WebSocket (for real-time communication)
- OpenAI GPT-4 Realtime API
- Twilio (for telephony services)

## Setup

1. Clone the repository:

   ```
   git clone https://github.com/egalaiev/voice-agent-codebender-demo.git
   ```

2. Install dependencies:

   ```
   npm install
   ```

3. Set up environment variables:
   Create a `.env` file in the root directory and add the following:

   ```
   VAPI_API_KEY=your_vapi_api_key
   ```

   Replace `your_vapi_api_key` with your actual VAPI API key.

4. Update the webhook URL:
   Open the `index.js` file and locate the `WEBHOOK_URL` constant. Replace the existing URL with your own webhook URL:

   ```javascript
   const WEBHOOK_URL = "https://your-webhook-url.com";
   ```

5. Start the server:
   ```
   npm start
   ```

## Usage

Once the server is running, it will handle incoming Twilio calls. The AI agent will engage with callers, transcribe their speech, generate appropriate responses, and extract relevant information from the conversation.

## Note

This project is a demonstration and should be adapted for production use, including proper error handling, security measures, and compliance with relevant regulations.
