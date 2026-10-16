/** Same split the legacy uploader uses (1,200 characters, no overlap), so joining chunks gives the text back exactly. */
export const CHUNK_SIZE = 1200;

export function chunkText(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) out.push(text.slice(i, i + CHUNK_SIZE));
  return out;
}
