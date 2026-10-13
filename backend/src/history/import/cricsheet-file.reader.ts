import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { CricsheetOriginalParser } from './cricsheet-original.parser';
import { ParseResult } from './parsed-match.types';

export interface ParsedFile {
  sha256: string;
  sizeBytes: number;
  result: ParseResult;
}

/** Streams one file line by line through the parser while hashing the exact bytes read. */
export async function readCricsheetFile(path: string): Promise<ParsedFile> {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  const stream = createReadStream(path);
  stream.on('data', (chunk) => {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    hash.update(bytes);
    sizeBytes += bytes.length;
  });

  const parser = new CricsheetOriginalParser();
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) parser.push(line);

  return { sha256: hash.digest('hex'), sizeBytes, result: parser.finish() };
}
