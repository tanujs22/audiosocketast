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
  socket.on('data', async (data) => {
    try {
      // Log the binary data for debugging
      console.log(`📦 Received data: ${data.length} bytes`);
      
      // Initial handshake
      if (!handshakeComplete) {
        // According to protocol, first send protocol version
        const response = Buffer.from("AudioSocket v1.0\r\n", 'utf8');
        socket.write(response);
        console.log(`👋 Sent AudioSocket protocol response`);
        handshakeComplete = true;
        
        // Extract UUID if possible from channel info
        const channelInfo = data.toString('utf8', 0, 100).split('\n')[0];
        console.log(`🔍 Channel info: ${channelInfo}`);
        
        // Try to get caller number from Asterisk channel name
        let caller = "6001"; // Hardcoded for testing
        let called = "5000"; // Default to voicebot extension
        
        console.log(`📞 Using caller=${caller}, called=${called}`);
        
        // Connect to Voicegenie
        try {
          sessionInfo = await initVoicegenieSession(caller, called, socketId);
          
          // Connect WebSocket to Voicegenie
          vgWebSocket = new WebSocket(sessionInfo.socketURL);
          
          vgWebSocket.on('open', () => {
            console.log(`✅ Connected to Voicegenie WebSocket for ${sessionInfo.callSid}`);
            
            // Send initial status
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
          
                // Ensure the socket is writable and the data is a Buffer
                if (socket.writable && Buffer.isBuffer(audioChunk)) {
                  socket.write(audioChunk, (err) => {
                    if (err) {
                      console.error('❌ Error sending audio to Asterisk:', err.message);
                    } else {
                      console.log(`📤 Sent audio (${audioChunk.length} bytes) to Asterisk`);
                    }
                  });
                } else {
                  console.error('❌ AudioSocket is not writable or invalid audioChunk');
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
                    socket.end();
                  }
                });
              }
              else {
                // Explicitly ignore and log non-media events without sending to Asterisk
                console.log(`📩 Ignoring non-media event from Voicegenie: ${msgData.event}`);
              }
            } catch (error) {
              console.error('❌ Error processing Voicegenie message:', error.message);
            }
          });
          
          
          vgWebSocket.on('error', (err) => {
            console.error('❌ Voicegenie WebSocket error:', err.message);
          });
          
          vgWebSocket.on('close', () => {
            console.log(`🔌 Voicegenie WebSocket closed for call ${sessionInfo?.callSid || socketId}`);
          });
          
          // Store session
          activeSessions.set(socketId, {
            socket,
            vgWebSocket,
            sessionInfo,
            startTime: new Date()
          });
          
        } catch (error) {
          console.error('❌ Failed to initialize Voicegenie session:', error.message);
          socket.end();
          return;
        }
        
        return;
      }
      
      // After handshake, handle audio data from Asterisk
      else if (vgWebSocket && vgWebSocket.readyState === WebSocket.OPEN) {
        // Skip empty or very small packets (likely control messages)
        if (data.length < 10) {
          console.log(`⏭️ Skipping small packet: ${data.length} bytes`);
          return;
        }
        
        console.log(`🎤 Processing audio from Asterisk: ${data.length} bytes`);
        
        // Convert to base64 for Voicegenie
        const base64Audio = data.toString('base64');
        
        // Create media event
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
        
        // Send to Voicegenie
        vgWebSocket.send(JSON.stringify(mediaEvent));
      }
    } catch (error) {
      console.error('❌ Error processing AudioSocket data:', error.message);
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