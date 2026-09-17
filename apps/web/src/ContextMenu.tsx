import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { menuPosition, submenuPosition } from "./menuPosition";

/** `above`: open upwards with the bottom edge at `y` instead of downwards from it. `width`: fixed width in px instead of the menu's own (to match the element it belongs to). */
export type MenuAnchor = { x: number; y: number; trigger: HTMLElement; above?: boolean; width?: number };

function navigate(event: KeyboardEvent<HTMLElement>) {
  const panel = (event.target as HTMLElement).closest<HTMLElement>('[role="menu"]');
  if (!panel) return;
  // data-menu-item: controls that are no buttons (the volume slider) but belong to the arrow-key order.
  const items = [...panel.querySelectorAll<HTMLButtonElement | HTMLInputElement>('[role^="menuitem"], [data-menu-item]')]
    .filter((item) => !item.disabled && item.closest('[role="menu"]') === panel);
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  let next: number;
  switch (event.key) {
    case "ArrowDown": next = (index + 1) % items.length; break;
    case "ArrowUp": next = (index - 1 + items.length) % items.length; break;
    case "Home": next = 0; break;
    case "End": next = items.length - 1; break;
    default: return;
  }
  event.preventDefault(); event.stopPropagation(); items[next]?.focus();
}

/** A body portal keeps the menu outside the member column's scrolling/clipping area. */
export function ContextMenu({ anchor, label, onClose, children }: {
  anchor: MenuAnchor; label: string; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [position, setPosition] = useState({ left: anchor.x, top: anchor.y });
  useLayoutEffect(() => {
    const menu = ref.current!;
    const place = () => {
      const box = menu.getBoundingClientRect();
      setPosition(menuPosition(anchor, box, { width: window.innerWidth, height: window.innerHeight }));
    };
    place();
    (menu.querySelector<HTMLElement>('[role^="menuitem"]') ?? menu).focus();
    const observer = new ResizeObserver(place); observer.observe(menu);
    return () => observer.disconnect();
  }, [anchor]);
  useEffect(() => {
    const close = () => closeRef.current();
    const outside = (event: Event) => { if (!ref.current?.contains(event.target as Node)) close(); };
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); anchor.trigger.focus(); close(); }
      if (event.key === "Tab") { anchor.trigger.focus(); close(); }
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("focusin", outside);
    window.addEventListener("scroll", outside, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", outside); window.removeEventListener("focusin", outside);
      window.removeEventListener("scroll", outside, true); window.removeEventListener("resize", close); window.removeEventListener("keydown", key);
    };
  }, [anchor]);
  return createPortal(
    <div ref={ref} className="user-context-menu" role="menu" aria-label={label} tabIndex={-1} style={anchor.width ? { ...position, width: anchor.width } : position}
      onKeyDown={navigate} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}>
      {children}
    </div>, document.body,
  );
}

/** Hover, click and ArrowRight all open the same submenu; it flips at the screen edge. */
export function ContextSubmenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef(false);
  useLayoutEffect(() => {
    if (!open) return;
    const box = trigger.current!.getBoundingClientRect();
    const menu = panel.current!.getBoundingClientRect();
    setPosition(submenuPosition(box, menu, { width: window.innerWidth, height: window.innerHeight }));
    if (focusOnOpen.current) { panel.current!.querySelector<HTMLElement>('[role^="menuitem"]')?.focus(); focusOnOpen.current = false; }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const parent = trigger.current?.closest('[role="menu"]');
    const close = () => setOpen(false);
    parent?.addEventListener("scroll", close);
    return () => parent?.removeEventListener("scroll", close);
  }, [open]);
  return <div className="context-submenu" role="none" onPointerEnter={(e) => { if (e.pointerType === "mouse") setOpen(true); }}
    onPointerLeave={() => setOpen(false)}
    onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
    <button ref={trigger} role="menuitem" aria-haspopup="menu" aria-expanded={open}
      onClick={() => { focusOnOpen.current = true; setOpen(true); if (open) panel.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus(); }}
      onKeyDown={(e) => { if (e.key === "ArrowRight") { e.preventDefault(); focusOnOpen.current = true; setOpen(true); if (open) panel.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus(); } }}>
      <span>{label}</span><Icon name="chevron-down" rotate={270} />
    </button>
    {open && <div ref={panel} className="user-context-menu context-submenu-panel" role="menu" aria-label={label} style={position}
      onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "Escape") { e.preventDefault(); e.stopPropagation(); trigger.current?.focus(); setOpen(false); } else navigate(e); }}>
      {children}
    </div>}
  </div>;
}
