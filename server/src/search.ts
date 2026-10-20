export interface ParsedSearch {
  /** FTS5 MATCH expression built only from quoted literal tokens (never raw user syntax). */
  ftsQuery: string | null;
  terms: string[];
  from: string[];
  inChannels: string[];
}

/**
 * Parse "deploy in:engineering from:maya" style queries.
 * Free-text tokens are individually quoted so FTS5 operators typed by the user are treated as literals.
 */
export function parseSearchQuery(raw: string): ParsedSearch {
  const from: string[] = [];
  const inChannels: string[] = [];
  const terms: string[] = [];
  // tokens: key:"quoted value" | key:value | "quoted phrase" | word
  const re = /(?:(in|from):(?:"([^"]*)"|(\S+)))|"([^"]*)"|(\S+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    if (m[1]) {
      const key = m[1].toLowerCase();
      const val = (m[2] ?? m[3] ?? '').replace(/^[#@]/, '').trim();
      if (!val) continue;
      (key === 'in' ? inChannels : from).push(val);
    } else {
      const t = (m[4] ?? m[5] ?? '').trim();
      if (t) terms.push(t);
    }
  }
  const tokens = terms
    .flatMap((t) => t.split(/[^\p{L}\p{N}_]+/u).filter(Boolean))
    .slice(0, 12);
  const ftsQuery = tokens.length
    ? tokens.map((t, i) => `"${t.replace(/"/g, '""')}"${i === tokens.length - 1 ? '*' : ''}`).join(' ')
    : null;
  return { ftsQuery, terms: tokens, from: from.slice(0, 5), inChannels: inChannels.slice(0, 5) };
}
