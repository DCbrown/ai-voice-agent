import WebSocket from "ws";
import dotenv from "dotenv";
import Fastify from "fastify";
import fastifyFormBody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";

// Load environment variables from .env file
dotenv.config();

// Retrieve the VAPI API key from environment variables
const { VAPI_API_KEY } = process.env;

if (!VAPI_API_KEY) {
  console.error("Missing VAPI API key. Please set it in the .env file.");
  process.exit(1);
}

console.log(
  "VAPI API Key length:",
  VAPI_API_KEY ? VAPI_API_KEY.length : "not set"
);
console.log("Server starting with configuration:");
console.log("- PORT:", PORT);
console.log("- VOICE:", VOICE);

// Initialize Fastify
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// Constants
const SYSTEM_MESSAGE = `## INSTRUCTIONS:
- You are The Codebender, an energetic AI Voice Agent on a mission to transform everyday coders into codebenders, people who bend lines of code into digital masterpieces!
- Please make sure to respond with a helpful voice via audio
- Your response should be concise and to the point, keep it short. Bring the conversation back on topic if necessary.
- You can ask the user questions. 

------
## PERSONALITY:
- Be upbeat and super kind
- Speak FAST as if excited

-----
## GOAL: 
- Your primary objective is to identify if the contact is interested in joining the Codebender Accelerator program.
- If they express interest, your mission is to provide them with useful information about our services and ultimately retrieve their name and address

## SERVICES INFORMATION:
- The Codebender Accelerator program has weekly calls where we discuss state-of-the-art AI topics
- We also have a course teaching you how to build AI apps, and MUCH more!
`;
const VOICE = "ballad"; //alloy
const PORT = process.env.PORT || 5050;

let callerNumber = null;
let callSid = null;

// Session management
const sessions = new Map();

// List of Event Types to log to the console
const LOG_EVENT_TYPES = [
  "response.content.done",
  "rate_limits.updated",
  "response.done",
  "input_audio_buffer.committed",
  "input_audio_buffer.speech_stopped",
  "input_audio_buffer.speech_started",
  "session.created",
  "response.text.done",
  "conversation.item.input_audio_transcription.completed",
];

// Root Route
fastify.get("/", async (request, reply) => {
  reply.send({ message: "Twilio Media Stream Server is running!" });
});

// Route for Twilio to handle incoming and outgoing calls
fastify.all("/incoming-call", async (request, reply) => {
  console.log("Incoming call");
  // Get all incoming call details from the request body or query string
  const twilioParams = request.body || request.query;

  // Extract caller's number and session ID (CallSid)
  callerNumber = twilioParams.From || null;
  callSid = twilioParams.CallSid; // Use Twilio's CallSid as a unique session ID
  console.log("Caller Number:", callerNumber);
  console.log("CallSid:", callSid);

  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                          <Response>
                              <Say>This call will be recorded for quality purposes.</Say>
                              <Connect>
                                  <Stream url="wss://${request.headers.host}/media-stream" />
                              </Connect>
                          </Response>`;

  reply.type("text/xml").send(twimlResponse);
});

// WebSocket route for media-stream
fastify.register(async (fastify) => {
  fastify.get("/media-stream", { websocket: true }, (connection, req) => {
    console.log("Client connected");

    const sessionId =
      req.headers["x-twilio-call-sid"] || `session_${Date.now()}`;
    let session = sessions.get(sessionId) || {
      transcript: "",
      streamSid: null,
    };
    sessions.set(sessionId, session);

    // Create VAPI WebSocket connection when a client connects
    const vapiWs = new WebSocket("wss://api.vapi.ai/streaming/v1", {
      headers: {
        Authorization: `Bearer ${VAPI_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    // Initialize session once VAPI WebSocket is open
    vapiWs.on("open", () => {
      console.log("Connected to VAPI WebSocket");

      const sessionUpdate = {
        type: "start",
        config: {
          audio: {
            encoding: "mulaw",
            sampleRate: 8000,
          },
          voice: {
            type: VOICE,
          },
          assistant: {
            prompt: SYSTEM_MESSAGE,
            temperature: 0.8,
          },
        },
      };

      console.log("Sending session update:", JSON.stringify(sessionUpdate));
      vapiWs.send(JSON.stringify(sessionUpdate));
    });

    // Handle VAPI WebSocket messages
    vapiWs.on("message", (data) => {
      try {
        const response = JSON.parse(data);
        console.log("Received VAPI message type:", response.type);

        switch (response.type) {
          case "transcript":
            const userMessage = response.text.trim();
            session.transcript += `👨‍💼 User: ${userMessage}\n`;
            console.log(`User (${sessionId}): ${userMessage}`);
            break;

          case "assistant_response":
            const agentMessage = response.text;
            session.transcript += `🎙️ Agent: ${agentMessage}\n`;
            console.log(`Agent (${sessionId}): ${agentMessage}`);
            break;

          case "audio":
            const audioDelta = {
              event: "media",
              streamSid: session.streamSid,
              media: { payload: response.chunk },
            };
            connection.socket.send(JSON.stringify(audioDelta));
            break;

          case "error":
            console.error("VAPI error:", response.message);
            break;
        }
      } catch (error) {
        console.error(
          "Error processing VAPI message:",
          error,
          "Raw message:",
          data
        );
      }
    });

    // Handle incoming Twilio WebSocket messages
    connection.socket.on("message", (message) => {
      try {
        const data = JSON.parse(message);

        switch (data.event) {
          case "media":
            if (vapiWs.readyState === WebSocket.OPEN) {
              const audioMessage = {
                type: "audio",
                chunk: data.media.payload,
              };
              vapiWs.send(JSON.stringify(audioMessage));
            }
            break;
          case "start":
            session.streamSid = data.start.streamSid;
            console.log("Incoming stream started:", session.streamSid);
            break;
          default:
            console.log("Received non-media event:", data.event);
            break;
        }
      } catch (error) {
        console.error("Error parsing message:", error, "Message:", message);
      }
    });

    // Handle WebSocket close and errors
    vapiWs.on("close", (code, reason) => {
      console.log("VAPI WebSocket closed with code:", code, "reason:", reason);
    });

    vapiWs.on("error", (error) => {
      console.error("VAPI WebSocket Error:", error);
    });

    // Clean up on connection close
    connection.socket.on("close", async () => {
      if (vapiWs.readyState === WebSocket.OPEN) {
        vapiWs.close();
      }
      console.log(`Client disconnected (${sessionId})`);
      session.transcript = cleanTranscript(session.transcript);
      console.log("Full Transcript:");
      console.log(session.transcript);

      // Clean up the session
      sessions.delete(sessionId);
    });
  });
});

fastify.listen({ port: PORT }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server is listening on port ${PORT}`);
});

// Remove "Agent: Agent message not found" lines and any resulting empty lines
function cleanTranscript(transcript) {
  return transcript
    .split("\n")
    .filter((line) => !line.includes("Agent: Agent message not found"))
    .filter((line) => line.trim() !== "")
    .join("\n\n");
}

// Function to make ChatGPT API completion call with structured outputs
async function makeChatGPTCompletion(transcript) {
  console.log("Starting ChatGPT API call...");
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-2024-08-06",
        messages: [
          {
            role: "system",
            content:
              "Extract customer details: name and address from the transcript. Do not invent any information; if the customer's name or address cannot be found, set the value to 'NONE'.",
          },
          { role: "user", content: transcript },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "customer_details_extraction",
            schema: {
              type: "object",
              properties: {
                customerName: { type: "string", default: "NONE" },
                customerAddress: { type: "string", default: "NONE" },
              },
              required: ["customerName", "customerAddress"],
            },
          },
        },
      }),
    });

    console.log("ChatGPT API response status:", response.status);
    const data = await response.json();
    console.log("Full ChatGPT API response:", JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    console.error("Error making ChatGPT completion call:", error);
    throw error;
  }
}

// Main function to extract and send customer details
async function processTranscriptAndSend(transcript, sessionId = null) {
  console.log(`Starting transcript processing for session ${sessionId}...`);
  try {
    // Make the ChatGPT completion call
    const result = await makeChatGPTCompletion(transcript);

    if (
      result.choices &&
      result.choices[0] &&
      result.choices[0].message &&
      result.choices[0].message.content
    ) {
      try {
        const parsedContent = JSON.parse(result.choices[0].message.content);
        console.log("Parsed content:", JSON.stringify(parsedContent, null, 2));

        if (parsedContent && callerNumber) {
          console.log("customerName", parsedContent.customerName);
          console.log("customerAddress", parsedContent.customerAddress);
          // Here you can do whatever you want with this data, save them in a db or sth else...
        } else {
          console.error("Unexpected JSON structure in ChatGPT response");
        }
      } catch (parseError) {
        console.error("Error parsing JSON from ChatGPT response:", parseError);
      }
    } else {
      console.error("Unexpected response structure from ChatGPT API");
    }
  } catch (error) {
    console.error("Error in processTranscriptAndSend:", error);
  }
}
