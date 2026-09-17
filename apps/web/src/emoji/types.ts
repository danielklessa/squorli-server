/** Shape of the generated picker data (`data.<locale>.ts`, written by tools/emoji.mjs). */
export type EmojiEntry = [char: string, name: string, keywords: string, shortcodes: string, skins?: string[]];
export type EmojiGroup = { key: string; emojis: EmojiEntry[] };
