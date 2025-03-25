#!/usr/bin/env node
// uuid-helper.js - Improved version

const agi = require('agi');
const { v4: uuidv4 } = require('uuid');

const agiServer = new agi.Handler();

agiServer.on('request', (req, res) => {
  // Generate a unique UUID for this call
  const uuid = uuidv4();
  
  // Get caller and called numbers from channel variables
  res.getVariable('CALLERID(num)', (err, callerNum) => {
    if (err) {
      console.error('Error getting caller ID:', err);
      callerNum = '6001'; // Default
    }
    
    res.getVariable('EXTEN', (err, calledNum) => {
      if (err) {
        console.error('Error getting extension:', err);
        calledNum = '5000'; // Default
      }
      
      // Set the caller info in a format we can extract in the AudioSocket server
      res.setVariable('CALLERINFO', `${callerNum}_${calledNum}`, (err) => {
        if (err) {
          console.error('Error setting CALLERINFO:', err);
        }
        
        // Set UUID for use in dialplan
        res.setVariable('CALL_UUID', uuid, (err) => {
          if (err) {
            console.error('Error setting UUID:', err);
          }
          
          // Log and hang up AGI
          console.log(`Generated UUID ${uuid} for call from ${callerNum} to ${calledNum}`);
          res.hangup();
        });
      });
    });
  });
});