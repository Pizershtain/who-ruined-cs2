/* global process, setTimeout */
setTimeout(() => process.exit(0), Number(process.argv[2] ?? 250));
