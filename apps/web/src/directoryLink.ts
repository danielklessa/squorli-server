import { DIRECTORY_WS_VERSION, DirectoryServerEvent, directoryWsAuthMessage, type DirectoryClientEvent } from "@squorli/protocol";
import { sign, type Identity } from "./identity";

/**
 * Second WebSocket connection (M7): to the directory service, for friends, presence and end-to-end encrypted
 * direct messages. Sign-in without a session: the service sends a challenge, we answer with a signature from the
 * device key (bound to the directory's host). Reconnect with growing backoff; the store receives
 * every event and the connection state.
 */
export type LinkStatus = "idle" | "connecting" | "connected" | "error";

export class DirectoryLink {
  private ws: WebSocket | null = null;
  private timer: number | null = null;
  private ping: number | null = null;
  private delay = 1000;
  private want = false;

  constructor(private readonly url: string, private readonly identity: Identity,
    private readonly onEvent: (e: DirectoryServerEvent) => void, private readonly onStatus: (s: LinkStatus, error?: string) => void) {}

  connect() {
    this.want = true;
    this.onStatus("connecting");
    const ws = new WebSocket(`${this.url.replace(/^http/, "ws")}/api/ws`);
    this.ws = ws;
    ws.onmessage = (m) => {
      const parsed = DirectoryServerEvent.safeParse(JSON.parse(String(m.data)));
      if (!parsed.success) return;
      const e = parsed.data;
      if (e.type === "challenge") {
        void sign(this.identity, directoryWsAuthMessage(e.host, e.nonce)).then((signature) => {
          if (this.ws === ws) this.send({ type: "auth", publicKey: this.identity.publicKey, signature, version: DIRECTORY_WS_VERSION });
        });
        return;
      }
      if (e.type === "welcome") {
        this.delay = 1000;
        this.onStatus("connected");
        if (this.ping) clearInterval(this.ping);
        this.ping = window.setInterval(() => this.send({ type: "ping", t: Date.now() }), 25_000);
      }
      if (e.type === "error" && (e.code === "version" || e.code === "unauthorized" || e.code === "unknown_account")) {
        // No reconnect: the client does not match the service, or the key has no account there.
        this.want = false;
        this.onStatus("error", e.message);
      }
      this.onEvent(e);
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (this.ping) { clearInterval(this.ping); this.ping = null; }
      if (!this.want) { this.onStatus("idle"); return; }
      this.onStatus("connecting");
      this.timer = window.setTimeout(() => this.connect(), this.delay);
      this.delay = Math.min(30_000, this.delay * 2);
    };
  }

  send(e: DirectoryClientEvent): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(e));
    return true;
  }

  close() {
    this.want = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.ping) { clearInterval(this.ping); this.ping = null; }
    this.ws?.close();
    this.ws = null;
  }
}
