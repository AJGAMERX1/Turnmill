import { useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import "./contextMenu.css";

export type MenuAnchor = { x: number; y: number; opener: HTMLElement };
export type MenuItem = {
  label: string;
  run: () => void;
  icon?: LucideIcon;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
};

export function menuTrigger(open: (anchor: MenuAnchor) => void) {
  return {
    "aria-haspopup": "menu" as const,
    onContextMenu(e: MouseEvent<HTMLElement>) {
      e.preventDefault();
      e.stopPropagation();
      open({ x: e.clientX, y: e.clientY, opener: e.currentTarget });
    },
    onKeyDown(e: KeyboardEvent<HTMLElement>) {
      if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      open({ x: rect.left + 12, y: rect.bottom, opener: e.currentTarget });
    },
  };
}

export function ContextMenu({ anchor, title, items, onClose }: {
  anchor: MenuAnchor;
  title: string;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    const menu = ref.current!;
    const bounds = menu.getBoundingClientRect();
    menu.style.left = Math.max(6, Math.min(anchor.x, innerWidth - bounds.width - 6)) + "px";
    menu.style.top = Math.max(6, Math.min(anchor.y, innerHeight - bounds.height - 6)) + "px";
    (menu.querySelector<HTMLButtonElement>("button:enabled") || menu).focus({ preventScroll: true });
    const outside = (event: Event) => {
      if (!menu.contains(event.target as Node)) closeRef.current();
    };
    const dismiss = () => closeRef.current();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside, true);
    window.addEventListener("blur", dismiss);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside, true);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("resize", dismiss);
    };
  }, [anchor]);

  const dismissToOpener = () => {
    onClose();
    if (anchor.opener.isConnected) anchor.opener.focus({ preventScroll: true });
  };
  function keydown(e: KeyboardEvent<HTMLDivElement>) {
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:enabled")];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") e.preventDefault();
      dismissToOpener();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const i = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1
        : (current + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length;
      buttons[i]?.focus();
    } else if (!e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      const command = buttons.find((b) => b.getAttribute("aria-keyshortcuts")?.toLowerCase() === e.key.toLowerCase());
      if (command) { e.preventDefault(); command.click(); }
    }
    e.stopPropagation();
  }
  return createPortal(
    <div ref={ref} role="menu" tabIndex={-1} aria-label={title + " actions"}
      className="tm-context-menu" onKeyDown={keydown} onContextMenu={(e) => e.preventDefault()}>
      <div className="tm-context-title" title={title}>{title}</div>
      {items.map(({ label, run, shortcut, icon: Icon, disabled, danger, divider }) => (
        <button key={label} role="menuitem" tabIndex={-1} disabled={disabled} aria-keyshortcuts={shortcut}
          className={(danger ? "danger " : "") + (divider ? "divider" : "")}
          onClick={() => { dismissToOpener(); run(); }}>
          {Icon && <Icon size={15} aria-hidden="true" />}<span>{label}</span>
          {shortcut && <kbd aria-hidden="true">{shortcut}</kbd>}
        </button>
      ))}
    </div>, document.body,
  );
}
