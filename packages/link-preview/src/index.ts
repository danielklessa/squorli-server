/**
 * Looking a link up on behalf of a user (docs/features/link-previews.md): the address rules against requests to the machine
 * itself or its private network, the guarded GET, the reading of a page's head, YouTube's oEmbed. Node only, no dependencies.
 * Used by the chat server (previews of channel messages, the radio's playlists and titles), by the desktop app (previews of
 * direct messages, fetched by the sender's own app) and, as a byte-identical copy, by the directory service (the same for
 * senders in a browser). One implementation on purpose: this is the code that decides what a stranger's link may reach.
 */
export * from "./addresses";
export * from "./fetch";
export * from "./lookup";
export * from "./parse";
export * from "./youtube";
