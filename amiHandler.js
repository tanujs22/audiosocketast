// amiHandler.js
const AmiClient = require('asterisk-ami-client');
const config = require('./config');

// Configure AMI settings
const AMI_CONFIG = {
  username: config.AMI_USERNAME || 'voicebot',
  password: config.AMI_PASSWORD || 'your_ami_password_here',
  host: config.AMI_HOST || '127.0.0.1',
  port: config.AMI_PORT || 5038,
};

// Create an instance with reconnect enabled
const ami = new AmiClient({
  reconnect: true,
  keepAlive: true,
  maxAttemptsCount: Infinity,
  attemptsDelay: 3000
});

// Connect to AMI
ami.connect(AMI_CONFIG.username, AMI_CONFIG.PASSWORD, { host: AMI_CONFIG.host, port: AMI_CONFIG.port })
  .then(() => console.log('Connected to Asterisk AMI!'))
  .catch(err => console.error('AMI Connection Error:', err));

// Add event listeners
ami.on('connect', () => {
  console.log('🔄 AMI connection established');
});

ami.on('disconnect', () => {
  console.error('❌ AMI connection lost. Attempting to reconnect...');
});

ami.on('reconnection', () => {
  console.log('🔄 Attempting to reconnect to AMI...');
});

// Stop audio playback
async function stopAudioPlayback(callChannel) {
  console.log(`🔇 Stopping audio playback on ${callChannel}`);
  return ami.action({
    Action: 'StopPlayTones',
    Channel: callChannel
  });
}

// Start call recording
async function startCallRecording(callChannel, recordingFileName) {
  console.log(`🎬 Starting recording on ${callChannel}`);
  return ami.action({
    Action: 'Monitor',
    Channel: callChannel,
    File: recordingFileName,
    Format: 'wav',
    Mix: true
  });
}

// Stop call recording
async function stopCallRecording(callChannel) {
  console.log(`⏹️ Stopping recording on ${callChannel}`);
  return ami.action({
    Action: 'StopMonitor',
    Channel: callChannel
  });
}

// Hangup call
async function endCall(callChannel) {
  console.log(`📴 Ending call on ${callChannel}`);
  return ami.action({
    Action: 'Hangup',
    Channel: callChannel
  });
}

// Warm transfer call
async function warmTransfer(callChannel, agentExtension) {
  console.log(`🔄 Transferring ${callChannel} to ${agentExtension}`);
  return ami.action({
    Action: 'Redirect',
    Channel: callChannel,
    Exten: agentExtension,
    Context: 'default',
    Priority: 1
  });
}

// Get channel info
async function getChannelInfo(callChannel) {
  console.log(`ℹ️ Getting info for channel ${callChannel}`);
  return ami.action({
    Action: 'GetVar',
    Channel: callChannel,
    Variable: 'CALLERID(num)'
  });
}

// Execute direct action
function action(actionParams, callback) {
  if (callback) {
    return ami.action(actionParams, callback);
  }
  return ami.action(actionParams);
}

module.exports = {
  stopAudioPlayback,
  startCallRecording,
  stopCallRecording,
  endCall,
  warmTransfer,
  getChannelInfo,
  action
};