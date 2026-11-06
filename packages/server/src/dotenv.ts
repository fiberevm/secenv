/** Parse .env text (KEY=value, optional `export`, quotes, # comments, multi-line double quotes). */
export function parseDotenv(text: string): Array<{ key: string; value: string }> {
  const result: Array<{ key: string; value: string }> = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*[=:]\s*(.*)$/.exec(line);
    if (!match) throw new Error(`Line ${i + 1}: expected KEY=value`);
    const key = match[1]!;
    let value = match[2]!;
    const quote = value[0];

    if (quote === '"' || quote === "'" || quote === "`") {
      let body = value.slice(1);
      // A quoted value may continue over several lines until its closing quote.
      while (!hasClosingQuote(body, quote) && i + 1 < lines.length) {
        body += "\n" + lines[++i];
      }
      const end = closingQuoteIndex(body, quote);
      if (end === -1) throw new Error(`Line ${i + 1}: unterminated ${quote} quote for ${key}`);
      value = body.slice(0, end);
      if (quote === '"') {
        value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
    } else {
      // Unquoted: strip an inline comment that follows whitespace.
      value = value.replace(/\s+#.*$/, "").trim();
    }
    result.push({ key, value });
  }
  return result;
}

function closingQuoteIndex(body: string, quote: string): number {
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\" && quote === '"') {
      i++;
      continue;
    }
    if (body[i] === quote) return i;
  }
  return -1;
}

function hasClosingQuote(body: string, quote: string): boolean {
  return closingQuoteIndex(body, quote) !== -1;
}
