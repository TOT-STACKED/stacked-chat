// Turns the assistant's plain text into a few safe blocks (paragraphs, lists, bold). Pure, so it can be tested.
// The page builds DOM nodes from these blocks (never innerHTML), so nothing the assistant writes can run as markup.

/** Remove the trailing "Source: ..." lines (we show sources as chips instead). */
export function stripSources(text) {
  return String(text || '').replace(/\n+\s*Sources?:[^\n]*$/gi, '').replace(/^\s*Sources?:[^\n]*$/gim, '').trim();
}

/** "a **b** c" -> [{t:'text',v:'a '},{t:'b',v:'b'},{t:'text',v:' c'}] */
export function inline(s) {
  const out = []; const re = /\*\*([^*\n]+)\*\*/g; let last = 0; let m;
  while ((m = re.exec(s))) { if (m.index > last) out.push({ t: 'text', v: s.slice(last, m.index) }); out.push({ t: 'b', v: m[1] }); last = m.index + m[0].length; }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) });
  return out.length ? out : [{ t: 'text', v: '' }];
}

/** Blocks: {type:'p', parts} | {type:'ol'|'ul', items:[parts]} */
export function parseBlocks(text) {
  const blocks = []; let list = null;
  const endList = () => { if (list) { blocks.push(list); list = null; } };
  for (const raw of stripSources(text).replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) { endList(); continue; }
    const ol = /^(\d+)[.)]\s+(.*)$/.exec(line); const ul = /^[-*•]\s+(.*)$/.exec(line);
    if (ol || ul) {
      const type = ol ? 'ol' : 'ul';
      if (list && list.type !== type) endList();
      if (!list) list = { type, items: [] };
      list.items.push(inline((ol ? ol[2] : ul[1]).trim()));
    } else {
      endList();
      const prev = blocks[blocks.length - 1];
      if (prev && prev.type === 'p' && !prev.closed) prev.parts.push({ t: 'text', v: ' ' }, ...inline(line));
      else blocks.push({ type: 'p', parts: inline(line) });
    }
  }
  endList();
  return blocks;
}

/** Readable text colour (dark or white) for a brand colour background. */
export function readableOn(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '#1B1A17';
  const n = parseInt(m[1], 16); const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const vsWhite = 1.05 / (L + 0.05); const vsInk = (L + 0.05) / (0.0103 + 0.05); // WCAG contrast ratios
  return vsInk >= vsWhite ? '#1B1A17' : '#FFFFFF';
}

/** YouTube thumbnail for a watch/short link, or null. */
export function youtubeThumb(url) {
  const m = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/.exec(String(url || ''));
  return m ? `https://img.youtube.com/vi/${m[1]}/mqdefault.jpg` : null;
}
