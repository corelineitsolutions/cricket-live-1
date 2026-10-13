export class CsvLineError extends Error {}

/**
 * Splits one CSV line (RFC 4180 quoting, `""` escapes). Cricsheet classic files never
 * have quoted newlines, so an unterminated quote is a malformed line.
 */
export function tokenizeCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let quotedField = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === ',') {
      fields.push(current);
      current = '';
      quotedField = false;
    } else if (char === '"' && current === '' && !quotedField) {
      inQuotes = true;
      quotedField = true;
    } else {
      current += char;
    }
  }
  if (inQuotes) throw new CsvLineError('unterminated quoted field');
  fields.push(current);
  return fields;
}
