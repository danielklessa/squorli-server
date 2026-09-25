import type { DmBlobRef, DmPreview, LinkPreview } from "@squorli/protocol";
import { memo, useCallback, useState } from "react";
import { useDmBlobUrl } from "./dmPreviewImage";
import { Icon } from "./Icon";
import { t } from "./i18n";
import { platform } from "./platform";
import { playerFrameAllow } from "./playerWindow";
import { safeHref } from "./safeHref";
import type { ServerConnection } from "./serverConnection";
import type { Store } from "./store";
import { youtubeChatPlayerSrc } from "./youtube";

/**
 * Previews of a message's links (docs/features/link-previews.md). Title and description arrive as text and are shown as
 * text; the picture never comes from the linked host: in a channel it is a copy on the chat server, in a direct message
 * the sender's encrypted picture from the directory's blob store, opened here. A YouTube video plays right in the chat, but
 * YouTube's player is loaded only when the reader presses play: until then the card is our picture and nobody's address
 * has gone to Google. Its sound plays where screen share audio plays, in the desktop app (App.tsx tells the shell the
 * device); a browser cannot route a foreign frame.
 * The x next to each preview, also next to a video, is there for the author only and takes that one away for everybody.
 * The lists are memoized with props that stay the same between renders: the chat renders on every keystroke.
 */
type Card = { url: string; kind: "page" | "youtube"; siteName: string | null; title: string | null; description: string | null; videoId?: string | undefined; start?: number | undefined };
/** The picture's address, null = none, "pending" = on its way (the card keeps its place, so nothing jumps). */
type Picture = string | null | "pending";

export const LinkPreviews = memo(function LinkPreviews({ messageId, previews, mine, conn, onError }: { messageId: string; previews: readonly LinkPreview[]; mine: boolean; conn: ServerConnection; onError: (message: string) => void }) {
  if (previews.length === 0) return null;
  const onRemove = mine ? (url: string) => { conn.api.removePreview(messageId, url).catch((e) => onError(String(e))); } : null;
  return (
    <div className="previews">
      {previews.map((p) => <PreviewRow key={p.url} card={p} picture={p.image ? conn.api.abs(p.image) : null} onRemove={onRemove} />)}
    </div>
  );
});

export const DmPreviews = memo(function DmPreviews({ messageId, peer, previews, mine, store, onError }: { messageId: string; peer: string; previews: readonly DmPreview[]; mine: boolean; store: Store; onError: (message: string) => void }) {
  const fetchBlob = useCallback((id: string) => store.fetchDmBlob(id), [store]);
  if (previews.length === 0) return null;
  const onRemove = mine ? (url: string) => { store.removeDmPreview(peer, messageId, url).catch((e) => onError(String(e))); } : null;
  return (
    <div className="previews">
      {previews.map((p) => <DmPreviewRow key={p.url} preview={p} fetchBlob={fetchBlob} onRemove={onRemove} />)}
    </div>
  );
});

function DmPreviewRow({ preview, fetchBlob, onRemove }: { preview: DmPreview; fetchBlob: (id: string) => Promise<Uint8Array>; onRemove: ((url: string) => void) | null }) {
  const picture = useDmBlobUrl(preview.image as DmBlobRef | null, fetchBlob);
  return <PreviewRow card={preview} picture={picture} onRemove={onRemove} />;
}

function PreviewRow({ card, picture, onRemove }: { card: Card; picture: Picture; onRemove: ((url: string) => void) | null }) {
  return (
    <div className="preview-row">
      {card.kind === "youtube" && card.videoId ? <VideoCard card={card} videoId={card.videoId} picture={picture} /> : <PageCard card={card} picture={picture} />}
      {onRemove && <button className="icon preview-remove" title={t("chat.removePreview")} aria-label={t("chat.removePreview")} onClick={() => onRemove(card.url)}><Icon name="x" /></button>}
    </div>
  );
}

const linkProps = { target: "_blank", rel: "noreferrer noopener" } as const;

function PageCard({ card: p, picture }: { card: Card; picture: Picture }) {
  // A link straight to a picture: the picture is all there is.
  if (!p.title) return picture && picture !== "pending" ? <a className="preview-image-only" href={safeHref(p.url)} title={p.url} {...linkProps}><img src={picture} alt="" loading="lazy" /></a> : null;
  return (
    <div className="preview-card">
      <div className="preview-text">
        {p.siteName && <span className="preview-site muted">{p.siteName}</span>}
        <a className="preview-title" href={safeHref(p.url)} title={p.url} {...linkProps}>{p.title}</a>
        {p.description && <p className="preview-description">{p.description}</p>}
      </div>
      {picture && <a className="preview-thumb" href={safeHref(p.url)} title={p.url} tabIndex={-1} {...linkProps}>{picture !== "pending" && <img src={picture} alt="" loading="lazy" />}</a>}
    </div>
  );
}

function VideoCard({ card: p, videoId, picture }: { card: Card; videoId: string; picture: Picture }) {
  const [playing, setPlaying] = useState(false);
  const title = p.title ?? t("chat.videoUntitled");
  return (
    <div className="preview-card video">
      <div className="preview-text">
        <span className="preview-site muted">{p.siteName ?? "YouTube"}</span>
        <a className="preview-title" href={safeHref(p.url)} title={p.url} {...linkProps}>{title}</a>
      </div>
      <div className="preview-video">
        {playing
          ? <iframe src={youtubeChatPlayerSrc(videoId, p.start ?? 0)} title={t("chat.videoFrame", { title })} allow={playerFrameAllow(platform.media.setChatPlayerOutput !== null)} allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
          : (
            <button className="preview-play" title={t("chat.playVideo")} aria-label={t("chat.playVideoNamed", { title })} onClick={() => setPlaying(true)}>
              {picture && picture !== "pending" && <img src={picture} alt="" loading="lazy" />}
              <span className="preview-play-mark"><Icon name="play" /></span>
            </button>
          )}
      </div>
    </div>
  );
}
