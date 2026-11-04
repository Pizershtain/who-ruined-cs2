import type { TerminalMatchUpdate } from '../src/index.js';

const allowed: TerminalMatchUpdate = {
  status: 'COMPLETED',
  resultFilePath: 'results/match.json.gz',
};

const forbidden: TerminalMatchUpdate = {
  // @ts-expect-error terminal completion cannot alter immutable upload identity
  originalFileName: 'replacement.dem',
};

void allowed;
void forbidden;
