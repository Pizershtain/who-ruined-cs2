import process from 'node:process';

process.once('message', () => process.exit(0));
