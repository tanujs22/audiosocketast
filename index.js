// index.js
const express = require('express');
const axios = require('axios');
require('dotenv').config();
const app = express();

const {
  stopAudioPlayback,
  startCallRecording,
  stopCallRecording,
  endCall,
  warmTransfer
} = require('./amiHandler');

const audioSocketServer = require('./audioSocketServer');
const config = require('./config');

app.use(express.json());
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path}`);
  next();
});

// Legacy API endpoint - can be removed later once fully migrated to AudioSocket
app.post('/api/calls', async (req, res) => {
  const { caller, called, callSid } = req.body;
  console.log('📥 Legacy /api/calls endpoint hit');
  
  try {
    // Response for backward compatibility
    res.json({
      status: "success",
      data: {
        socketURL: "DEPRECATED_USE_AUDIOSOCKET_INSTEAD",
        rtpPort: 10000
      },
      message: "This endpoint is deprecated. Please use AudioSocket integration."
    });
  } catch (error) {
    console.error('❌ Error in /api/calls:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// API endpoints for additional functionalities required by ORI

// Start Recording API
app.post('/api/start-recording', async (req, res) => {
  const { callChannel, recordingFileName } = req.body;
  console.log(`🎬 Start recording request for channel ${callChannel}`);
  
  try {
    await startCallRecording(callChannel, recordingFileName);
    console.log(`✅ Recording started for channel ${callChannel}`);
    res.json({ success: true });
  } catch (err) {
    console.error(`❌ Error starting recording for channel ${callChannel}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Stop Recording API
app.post('/api/stop-recording', async (req, res) => {
  const { callChannel } = req.body;
  console.log(`⏹️ Stop recording request for channel ${callChannel}`);
  
  try {
    await stopCallRecording(callChannel);
    console.log(`✅ Recording stopped for channel ${callChannel}`);
    res.json({ success: true });
  } catch (err) {
    console.error(`❌ Error stopping recording for channel ${callChannel}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Stop Audio Playback API
app.post('/api/stop-audio', async (req, res) => {
  const { callChannel } = req.body;
  console.log(`🔇 Stop audio request for channel ${callChannel}`);
  
  try {
    await stopAudioPlayback(callChannel);
    console.log(`✅ Audio playback stopped for channel ${callChannel}`);
    res.json({ success: true });
  } catch (err) {
    console.error(`❌ Error stopping audio for channel ${callChannel}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// End Call API
app.post('/api/end-call', async (req, res) => {
  const { callChannel } = req.body;
  console.log(`📴 End call request for channel ${callChannel}`);
  
  try {
    await endCall(callChannel);
    console.log(`✅ Call ended for channel ${callChannel}`);
    res.json({ success: true });
  } catch (err) {
    console.error(`❌ Error ending call for channel ${callChannel}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Warm Transfer API - Direct mode (not using AudioSocket)
app.post('/api/warm-transfer', async (req, res) => {
  const { callChannel, agentExtension, audioUrl, metadata } = req.body;
  console.log(`🔄 Direct transfer request for channel ${callChannel} to agent ${agentExtension}`);
  
  try {
    await warmTransfer(callChannel, agentExtension);
    console.log(`✅ Call transferred to agent ${agentExtension}`);
    res.json({ success: true });
  } catch (err) {
    console.error(`❌ Error transferring call to agent ${agentExtension}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// System status API
app.get('/api/system-status', (req, res) => {
  const activeSessions = audioSocketServer.getActiveSessions();
  
  const status = {
    activeCalls: activeSessions.sessions,
    callCount: activeSessions.count,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    timestamp: new Date().toISOString()
  };
  
  console.log(`📊 System status: ${activeSessions.count} active calls`);
  res.json(status);
});

// Start servers
const MIDDLEWARE_SERVER_PORT = config.MIDDLEWARE_SERVER_PORT || 3000;
app.listen(MIDDLEWARE_SERVER_PORT, () => {
  console.log(`\n🚀 Middleware HTTP server running on port ${MIDDLEWARE_SERVER_PORT}`);
  
  // Start AudioSocket server
  audioSocketServer.start();
  
  console.log(`🔗 Using Voicegenie webhook: ${config.VG_WEBHOOK_URL}`);
  console.log(`📞 Ready to handle calls!\n`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received. Shutting down gracefully.');
  process.exit(0);
});