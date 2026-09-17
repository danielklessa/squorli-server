import { useEffect, useLayoutEffect, useRef, type MutableRefObject, type TextareaHTMLAttributes } from "react";
import { grownHeight } from "./autoGrow";

/**
 * Textarea that grows with its content up to a third of the chat area (`.chat`, user's wish) and only then scrolls.
 * Used for the composers of the channel chat and the direct messages and for editing a message. Measured in script and
 * not with CSS `field-sizing`, which Firefox does not know. `inputRef` hands the element to the owner (focus after sending,
 * inserting emoji at the caret).
 */
export function AutoGrowTextarea({ inputRef, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string; inputRef?: MutableRefObject<HTMLTextAreaElement | null> }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  function fit() {
    const el = ref.current;
    if (!el) return;
    const area = el.closest(".chat") ?? document.documentElement;
    el.style.height = "auto";   // otherwise scrollHeight never shrinks again
    const { height, scroll } = grownHeight(el.scrollHeight + el.offsetHeight - el.clientHeight, area.clientHeight);
    el.style.height = `${height}px`;
    el.style.overflowY = scroll ? "auto" : "hidden";
  }

  useLayoutEffect(fit, [props.value]);
  // Window or layout changes: the third is a different height, and a different width wraps the text differently.
  useEffect(() => {
    const area = ref.current?.closest(".chat");
    if (!area) return;
    const ro = new ResizeObserver(fit);
    ro.observe(area);
    return () => ro.disconnect();
  }, []);

  return <textarea {...props} ref={(el) => { ref.current = el; if (inputRef) inputRef.current = el; }} />;
}
