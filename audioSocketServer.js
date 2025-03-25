// audioSocketServer.js
const net = require('net');
const WebSocket = require('ws');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const ami = require('./amiHandler');
const config = require('./config');

// Store active connections
const activeSessions = new Map();

// Function to send status callback
async function sendStatusCallback(url, callSid, status) {
  try {
    await axios.post(url, {
      CallSid: callSid,
      CallStatus: status
    }, {
      headers: {
        'User-Agent': 'vicidial',
        'Content-Type': 'application/json'
      }
    });
    console.log(`📞 Call status '${status}' sent successfully for ${callSid}`);
  } catch (err) {
    console.error('❌ Error sending call status:', err.message);
  }
}

// Function to send hangup callback
async function sendHangupCallback(url, payload) {
  try {
    await axios.post(url, payload, {
      headers: {
        'User-Agent': 'vicidial',
        'Content-Type': 'application/json'
      }
    });
    console.log('📞 Hangup event sent successfully');
  } catch (err) {
    console.error('❌ Error sending hangup event:', err.message);
  }
}

// Initialize Voicegenie session
async function initVoicegenieSession(caller, called, sessionId) {
  console.log(`🌐 Initializing Voicegenie session for call ${sessionId}`);
  
  // Generate a unique call ID
  const callSid = `CALL_${Date.now()}`;
  
  // Make API request to Voicegenie
  try {
    const vgResponse = await axios.post(
      config.VG_WEBHOOK_URL,
      {
        AccountSid: "",
        ApiVersion: "2010-04-01",
        CallSid: callSid,
        CallStatus: "ringing",
        Called: called,
        CalledCity: "",
        CalledCountry: "",
        CalledState: "",
        CalledZip: "",
        Caller: caller,
        CallerCity: "",
        CallerCountry: "",
        CallerState: "",
        CallerZip: "",
        Direction: "inbound",
        From: caller,
        FromCity: "",
        FromCountry: "",
        FromState: "",
        FromZip: "",
        To: called,
        ToCity: "",
        ToCountry: "",
        ToState: "",
        ToZip: ""
      },
      {
        headers: {
          'User-Agent': 'vicidial',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.VG_AUTH_TOKEN}`
        }
      }
    );
    
    console.log(`✅ Voicegenie responded for call ${callSid}`);
    
    // Extract response data
    const { socketURL, HangupUrl, statusCallbackUrl, recordingStatusUrl } = 
      vgResponse.data.data.data;
    
    return {
      callSid,
      socketURL,
      HangupUrl,
      statusCallbackUrl,
      recordingStatusUrl,
      caller,
      called
    };
  } catch (error) {
    console.error('❌ Error contacting Voicegenie:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
    throw error;
  }
}

// Create TCP server for AudioSocket
const server = net.createServer((socket) => {
  // Assign unique ID for this connection
  const socketId = uuidv4();
  let sessionInfo = null;
  let vgWebSocket = null;
  let sequenceNumber = 1;
  let handshakeComplete = false;
  
  console.log(`🔌 New AudioSocket connection: ${socket.remoteAddress}:${socket.remotePort}`);
 
// Handle data from Asterisk
// Fix for the socket.on('data') handler in audioSocketServer.js

socket.on('data', async (data) => {
    try {
      console.log(`📦 Received data: ${data.length} bytes`);
  
      // Initial handshake
      if (!handshakeComplete) {
        // Parse the handshake information more carefully
        const handshakeText = data.toString('utf8').trim();
        console.log(`👋 Handshake received: ${handshakeText}`);
  
        // Respond with the protocol version
        const response = Buffer.from("AudioSocket v1.0\r\n", 'utf8');
        socket.write(response);
        console.log(`👋 Sent AudioSocket protocol response`);
        handshakeComplete = true;
  
        // Try to extract channel info more reliably
        let caller = "6001"; // Default
        let called = "5000"; // Default
        
        // Extract caller/called from channel info if possible
        try {
          const channelInfo = handshakeText.split('\n')[0].trim();
          console.log(`🔍 Channel info: ${channelInfo}`);
          
          // If your AGI script provides caller/called in a structured format,
          // extract it here. Example: if format is "CALLER_CALLED"
          if (channelInfo.includes('_')) {
            const parts = channelInfo.split('_');
            if (parts.length >= 2) {
              caller = parts[0];
              called = parts[1];
            }
          }
        } catch (e) {
          console.log(`⚠️ Could not parse channel info, using defaults: ${e.message}`);
        }
        
        console.log(`📞 Using caller=${caller}, called=${called}`);
  
        // Initialize Voicegenie session
        try {
          sessionInfo = await initVoicegenieSession(caller, called, socketId);
  
          // Connect WebSocket to Voicegenie
          vgWebSocket = new WebSocket(sessionInfo.socketURL);
  
          vgWebSocket.on('open', () => {
            console.log(`✅ Connected to Voicegenie WebSocket for ${sessionInfo.callSid}`);
  
            // Send status callback
            sendStatusCallback(sessionInfo.statusCallbackUrl, sessionInfo.callSid, 'initiated');
  
            // Send start event
            vgWebSocket.send(JSON.stringify({
              sequenceNumber: 0,
              event: "start",
              start: {
                callId: sessionInfo.callSid,
                streamId: `stream_${Date.now()}`,
                accountId: "10144634",
                tracks: ["inbound"],
                mediaFormat: {
                  encoding: "audio/mulaw",
                  sampleRate: 8000
                },
              },
              extra_headers: "{}"
            }));
          });
  
          vgWebSocket.on('message', (message) => {
            try {
              const msgData = JSON.parse(message);
  
              if (msgData.event === 'media' && msgData.media && msgData.media.payload) {
                console.log(`📩 Received media from Voicegenie (${msgData.media.payload.length} chars)`);
  
                const audioChunk = Buffer.from(msgData.media.payload, 'base64');
                console.log(`🔊 Decoded ${audioChunk.length} bytes of audio`);
  
                // Critical fix: Check if socket is still connected
                if (socket && !socket.destroyed && socket.writable && Buffer.isBuffer(audioChunk)) {
                  socket.write(audioChunk, (err) => {
                    if (err) {
                      console.error('❌ Error sending audio to Asterisk:', err.message);
                    } else {
                      console.log(`📤 Sent audio (${audioChunk.length} bytes) to Asterisk`);
                    }
                  });
                } else {
                  console.error('❌ AudioSocket is not writable or invalid audioChunk');
                  // Don't close the connection here, just log the error
                }
              }
              else if (msgData.event === 'transfer' && msgData.transfer?.agentUri) {
                const agentUri = msgData.transfer.agentUri;
                console.log(`🔄 Transfer request to agent: ${agentUri}`);
  
                ami.action({
                  Action: 'Setvar',
                  Variable: 'AGENT_SIP_URI',
                  Value: agentUri
                }, (err) => {
                  if (err) {
                    console.error('❌ Error setting AGENT_SIP_URI:', err.message);
                  } else {
                    console.log(`✅ AGENT_SIP_URI set to ${agentUri}`);
                    // Don't end the socket here, let Asterisk handle it
                    // socket.end();
                  }
                });
              }
              else {
                console.log(`📩 Ignoring non-media event from Voicegenie: ${msgData.event}`);
              }
            } catch (error) {
              console.error('❌ Error processing Voicegenie message:', error.message);
            }
          });
  
          vgWebSocket.on('error', (err) => {
            console.error('❌ Voicegenie WebSocket error:', err.message);
            // Don't close the socket on WebSocket error
          });
  
          vgWebSocket.on('close', () => {
            console.log(`🔌 Voicegenie WebSocket closed for call ${sessionInfo?.callSid || socketId}`);
            // Only close the socket if Voicegenie explicitly requested it
            // socket.end();
          });
  
          activeSessions.set(socketId, {
            socket,
            vgWebSocket,
            sessionInfo,
            startTime: new Date()
          });
        } catch (error) {
          console.error('❌ Failed to initialize Voicegenie session:', error.message);
          socket.end();
        }
  
        return; // Skip further processing for handshake packet
      }
  
      // After handshake, handle audio data from Asterisk
      if (vgWebSocket && vgWebSocket.readyState === WebSocket.OPEN) {
        // Skip very small packets that might be control messages
        if (data.length < 10) {
          console.log(`⏭️ Skipping small packet: ${data.length} bytes`);
          return;
        }
  
        console.log(`🎤 Processing audio from Asterisk: ${data.length} bytes`);
  
        // Convert audio to base64
        const base64Audio = data.toString('base64');
  
        // Send audio to Voicegenie
        const mediaEvent = {
          sequenceNumber: sequenceNumber++,
          event: 'media',
          media: {
            track: 'inbound',
            timestamp: Date.now().toString(),
            chunk: 1,
            payload: base64Audio
          },
          extra_headers: "{}"
        };
  
        vgWebSocket.send(JSON.stringify(mediaEvent));
      } else if (vgWebSocket) {
        console.log(`⏳ WebSocket not ready, state: ${vgWebSocket.readyState}`);
      } else {
        console.log(`⚠️ No WebSocket available for audio forwarding`);
      }
    } catch (error) {
      console.error('❌ Error processing AudioSocket data:', error.message);
      // Don't close the socket on processing error
    }
  });
  
  
  // Handle socket close
  socket.on('close', () => {
    console.log(`🔌 AudioSocket connection closed: ${socketId}`);
    
    const session = activeSessions.get(socketId);
    if (session && session.sessionInfo) {
      // Close WebSocket if still open
      if (session.vgWebSocket && session.vgWebSocket.readyState === WebSocket.OPEN) {
        // Send completed status
        sendStatusCallback(session.sessionInfo.statusCallbackUrl, session.sessionInfo.callSid, 'completed');
        
        // Send hangup notification
        sendHangupCallback(session.sessionInfo.HangupUrl, {
          hangupCause: "NORMAL_CLEARING",
          disconnectedBy: session.sessionInfo.caller,
          AnswerTime: new Date().toISOString(),
          BillDuration: "0",
          BillRate: "0.006",
          CallStatus: "completed",
          CallUUID: session.sessionInfo.callSid,
          Direction: "inbound",
          Duration: "0",
          EndTime: new Date().toISOString(),
          Event: "Hangup",
          From: session.sessionInfo.caller,
          HangupSource: "Callee",
          SessionStart: session.startTime.toISOString(),
          StartTime: session.startTime.toISOString(),
          To: session.sessionInfo.called,
          TotalCost: "0.00000"
        });
        
        // Close WebSocket
        session.vgWebSocket.close();
      }
      
      // Remove session
      activeSessions.delete(socketId);
    }
  });
  
  // Handle errors
  socket.on('error', (err) => {
    console.error(`❌ AudioSocket error:`, err.message);
  });
});

// Start the AudioSocket server
const AUDIOSOCKET_PORT = config.AUDIOSOCKET_PORT || 8090;

function start() {
  // Handle port in use error gracefully
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ ERROR: Port ${AUDIOSOCKET_PORT} is already in use!`);
      console.error('Please ensure no other process is using this port or change the AUDIOSOCKET_PORT in config.');
      console.error('You can check what process is using the port with: "sudo lsof -i :8090"');
      console.error('Then either stop that process or change the port in your .env file');
      
      // Exit with non-zero code to indicate error
      process.exit(1);
    } else {
      console.error(`❌ AudioSocket server error:`, err);
    }
  });

  try {
    server.listen(AUDIOSOCKET_PORT, () => {
      console.log(`🚀 AudioSocket server listening on port ${AUDIOSOCKET_PORT}`);
    });
  } catch (error) {
    console.error(`❌ Failed to start AudioSocket server:`, error.message);
    process.exit(1);
  }
  
  return server;
}

// Get current sessions (for monitoring)
function getActiveSessions() {
  return {
    count: activeSessions.size,
    sessions: Array.from(activeSessions.keys())
  };
}

module.exports = { start, getActiveSessions };