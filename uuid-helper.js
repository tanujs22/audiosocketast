#!/usr/bin/env node

// Simple script to generate a UUID and output it for Asterisk AGI
const { v4: uuidv4 } = require('uuid');

// Generate UUID
const uuid = uuidv4();

// Output for Asterisk AGI
process.stdout.write(`SET VARIABLE UUID "${uuid}"\n\n`);
process.exit(0);