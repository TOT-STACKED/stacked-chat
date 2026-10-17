import { describe, expect, it } from 'vitest';
import { inline, parseBlocks, readableOn, stripSources, youtubeThumb } from '../web/chat/render.js';

describe('chat page: rendering the assistant text safely', () => {
  it('splits text into paragraphs, lists and bold, and hides the Source line (shown as chips instead)', () => {
    const blocks = parseBlocks('Breaks are **twenty minutes**.\n\n1. Tell your manager\n2) Clock out\n\n- bring a drink\n\nSource: Staff handbook');
    expect(blocks.map((b) => b.type)).toEqual(['p', 'ol', 'ul']);
    expect(blocks[0]!.parts).toEqual([{ t: 'text', v: 'Breaks are ' }, { t: 'b', v: 'twenty minutes' }, { t: 'text', v: '.' }]);
    expect((blocks[1] as unknown as { items: unknown[] }).items).toHaveLength(2);
    expect(stripSources('Answer.\nSource: A\nSource: B')).toBe('Answer.');
  });
  it('treats markup as plain text (the page builds DOM nodes from text, never HTML)', () => {
    const [b] = parseBlocks('<img src=x onerror=alert(1)> and <script>alert(1)</script>');
    expect(b!.parts.every((p: { t: string }) => p.t === 'text')).toBe(true);
    expect(JSON.stringify(inline('**<b>x</b>**'))).toContain('<b>x</b>'); // kept as text, so it will display literally
  });
  it('joins soft-wrapped lines and ignores empty text', () => {
    expect(parseBlocks('one\ntwo')[0]!.parts.map((p: { v: string }) => p.v).join('')).toBe('one two');
    expect(parseBlocks('   \n\n')).toEqual([]);
  });
  it('picks readable text for any brand colour', () => {
    expect(readableOn('#E87830')).toBe('#1B1A17'); expect(readableOn('#112233')).toBe('#FFFFFF'); expect(readableOn('#FFFFFF')).toBe('#1B1A17');
    expect(readableOn('not a colour')).toBe('#1B1A17');
  });
  it('finds YouTube thumbnails only for YouTube links', () => {
    expect(youtubeThumb('https://youtu.be/dQw4w9WgXcQ')).toBe('https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg');
    expect(youtubeThumb('https://cdn.x/clip.mp4')).toBeNull();
  });
});

describe('the shared DOM helper', () => {
  it('never writes the words "null", "false" or "undefined" onto a page (append and prepend skip empty values)', async () => {
    class FakeElement { got: unknown[] = []; append(...n: unknown[]) { this.got = n; } prepend(...n: unknown[]) { this.got = n; } }
    (globalThis as unknown as { Element: unknown }).Element = FakeElement;
    await import('../web/manage/dom.js');
    const el = new FakeElement(); const node = { nodeType: 1 };
    el.append(null, node, false, undefined, 'text', 0);
    expect(el.got).toEqual([node, 'text', 0]);
    el.prepend(false, node); expect(el.got).toEqual([node]);
  });
});
