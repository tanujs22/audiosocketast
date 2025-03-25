#!/usr/bin/env node
// hangup-notify.js

const axios = require('axios');
const config = require('./config');

// Get arguments from command line
const caller = process.argv[2] || '';
const called = process.argv[3] || '';
const channel = process.argv[4] || '';
const uniqueid = process.argv[5] || '';
const callUuid = process.argv[6] || '';

console.log(`Call hangup detected: ${caller} -> ${called} (UUID: ${callUuid || uniqueid})`);

// You can notify your AudioSocket server about the hangup
// This is useful for cleaning up resources
axios.post('http://localhost:3000/hangup', {
  caller,
  called,
  channel,
  uniqueid,
  callUuid: callUuid || uniqueid,
  timestamp: new Date().toISOString()
}).then(() => {
  console.log('Hangup notification sent successfully');
  process.exit(0);
}).catch(error => {
  console.error('Failed to send hangup notification:', error.message);
  process.exit(1);
});

// Set a timeout to exit in case the HTTP request hangs
setTimeout(() => {
  console.error('Hangup notification timed out');
  process.exit(1);
}, 5000);