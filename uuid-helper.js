#!/usr/bin/env node

// Simple script to generate a UUID and output it for Asterisk AGI
const { v4: uuidv4 } = require('uuid');

// Generate UUID
const uuid = uuidv4();

// Output for Asterisk AGI
console.log(`SET VARIABLE UUID "${uuid}"`);
console.log(`"`); // Empty line as required by AGI protocol
process.exit(0);