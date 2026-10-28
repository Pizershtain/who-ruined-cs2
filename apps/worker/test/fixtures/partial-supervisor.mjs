import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

process.once('message', async (message) => {
  const target = path.resolve(process.env.DATA_DIR, ...message.outputRelative.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, Buffer.from('truncated-not-gzip'));
  if (process.send) process.send({ ok: true });
});
