// config.js
module.exports = {
    // Middleware server configuration
    MIDDLEWARE_SERVER_PORT: process.env.MIDDLEWARE_SERVER_PORT || 3000,
    
    // AudioSocket server configuration
    AUDIOSOCKET_PORT: process.env.AUDIOSOCKET_PORT || 8090,
    
    // Voicegenie configuration
    VG_WEBHOOK_URL: process.env.VG_WEBHOOK_URL || "https://voicegenie-demo-dc.oriserve.com/oriIncomingCallHandler",
    VG_AUTH_TOKEN: process.env.VG_AUTH_TOKEN || "your_auth_token_here",
    
    // AMI configuration
    AMI_HOST: process.env.AMI_HOST || "127.0.0.1",
    AMI_PORT: process.env.AMI_PORT || 5038,
    AMI_USERNAME: process.env.AMI_USERNAME || "voicebot",
    AMI_PASSWORD: process.env.AMI_PASSWORD || "supersecret123"
  };
