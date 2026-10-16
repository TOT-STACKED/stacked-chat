import { z } from 'zod';

/**
 * The chat page is built by pasting these values straight into HTML, CSS and attributes, so they are kept to plain
 * text. No angle brackets or quotes (markup), no backslashes, braces or backticks (script/CSS), and no "$" (it has a
 * special meaning in the string replace that builds the page).
 */
const FORBIDDEN = /[<>"`\\{}$\u0000-\u001f\u007f]/;
export const plainText = (max: number) => z.string().trim().max(max)
  .refine((v) => !FORBIDDEN.test(v), 'Plain text only: no < > " ` \\ { } $ or line breaks');

export const hexColour = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #E87830');
export const logoUrl = z.string().trim().max(500).url()
  .refine((v) => /^https:\/\//i.test(v), 'The logo link must start with https://')
  .refine((v) => !/[\s<>"'`\\{}$]/.test(v), 'That link has characters we cannot use');

/** An empty string means "go back to the default" (stored as null). */
const orNull = <T extends z.ZodType>(schema: T) => z.union([z.literal('').transform(() => null), schema]);

export const BrandingPatch = z.object({
  bot_name: orNull(plainText(40)).optional(),
  welcome_heading: orNull(plainText(80)).optional(),
  welcome_message: orNull(plainText(300)).optional(),
  primary_color: orNull(hexColour).optional(),
  logo_url: orNull(logoUrl).optional(),
}).strict().refine((b) => Object.keys(b).length > 0, 'Nothing to change');
export type BrandingPatchT = z.infer<typeof BrandingPatch>;
