import { useEffect, useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Search } from "lucide-react";
import { Modal } from "./Dialogs";
import {
  searchCommands,
  shortcutLabel,
  surfaceCommands,
  type Command,
  type PaletteContext,
  type SearchableCommand,
  type Workspace,
} from "./commands";
import "./commandPalette.css";

const historyKey = "turnmill.command-history.v1";
function recentCommands(scope: string): string[] {
  try {
    const data = JSON.parse(localStorage.getItem(historyKey) || "{}")[scope];
    return Array.isArray(data)
      ? data.filter((s): s is string => typeof s === "string").slice(0, 6)
      : [];
  } catch {
    return [];
  }
}
function remember(scope: string, key: string) {
  try {
    const data = JSON.parse(localStorage.getItem(historyKey) || "{}");
    data[scope] = [
      key,
      ...recentCommands(scope).filter((k) => k !== key),
    ].slice(0, 6);
    localStorage.setItem(historyKey, JSON.stringify(data));
  } catch {
    /* The keyboard workflow also works with browser storage disabled. */
  }
}

export default function CommandPalette({
  context,
  known,
  mode,
  onClose,
}: {
  context: PaletteContext;
  known: Command[];
  mode: Workspace;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(context.initialQuery || ""),
    [selected, setSelected] = useState(""),
    [version, refresh] = useState(0);
  const [scope] = useState(
    () => context.root.getAttribute("aria-label") || mode,
  );
  const [recent] = useState(() => recentCommands(scope));
  const resultsId = useId(),
    hintId = useId(),
    input = useRef<HTMLInputElement>(null);
  const commands = useMemo(
    () => surfaceCommands(known, context.root, mode),
    [known, context, version, mode],
  );
  const results = useMemo(
    () => searchCommands(commands, query, recent),
    [commands, query, recent],
  );
  const activeIndex = Math.max(
    0,
    results.findIndex((c) => c.key === selected),
  );
  const active = results[activeIndex];
  useEffect(() => {
    const observer = new MutationObserver((records) => {
      if (
        records.some(
          (r) =>
            !(
              r.target instanceof Element ? r.target : r.target.parentElement
            )?.closest(".command-palette"),
        )
      )
        refresh((v) => v + 1);
    });
    observer.observe(context.root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "disabled",
        "aria-disabled",
        "hidden",
        "open",
        "aria-label",
      ],
    });
    input.current?.focus();
    return () => observer.disconnect();
  }, [context]);
  useEffect(() => {
    if (active)
      document
        .getElementById(resultsId + "-" + active.key)
        ?.scrollIntoView({ block: "nearest" });
  }, [active?.key, resultsId]);

  function choose(c?: SearchableCommand) {
    if (!c || c.disabled || !context.root.isConnected) return;
    if (
      !/^(remove|delete|clear|discard|cancel|suppress|restore)/i.test(c.title)
    )
      remember(scope, c.key);
    // Close the native modal before focusing its parent. Synchronous execution also
    // preserves user activation for file choosers, print windows and downloads.
    flushSync(onClose);
    c.run();
  }
  return (
    <Modal
      title="Command palette"
      className="command-palette"
      onClose={onClose}
    >
      <div className="palette-search">
        <Search size={18} aria-hidden="true" />
        <input
          ref={input}
          autoFocus
          aria-label="Search commands"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={resultsId}
          aria-expanded="true"
          aria-activedescendant={
            active ? resultsId + "-" + active.key : undefined
          }
          aria-describedby={hintId}
          placeholder="Find a tool, setting or command…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected("");
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const direction = e.key === "ArrowDown" ? 1 : -1;
              if (results.length)
                setSelected(
                  results[
                    (activeIndex + direction + results.length) % results.length
                  ].key,
                );
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (!e.repeat) choose(active);
            }
          }}
        />
      </div>
      <div className="palette-scope">
        <span>{scope}</span>
        <span role="status">
          {results.length} {results.length === 1 ? "command" : "commands"}
        </span>
      </div>
      <div
        className="commands palette-results"
        id={resultsId}
        role="listbox"
        aria-label="Matching commands"
      >
        {results.map((c, i) => (
          <div
            role="option"
            id={resultsId + "-" + c.key}
            aria-selected={i === activeIndex}
            aria-disabled={!!c.disabled}
            className={"palette-option" + (i === activeIndex ? " active" : "")}
            key={c.key}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setSelected(c.key);
              choose(c);
            }}
          >
            <div>
              <b>{c.title}</b>
              <small>
                {c.group}
                {!query && recent.includes(c.key) ? " · Recent" : ""}
              </small>
              {c.disabled && (
                <span className="palette-reason">
                  {c.reason ||
                    "Unavailable with the current inputs or selection."}
                </span>
              )}
            </div>
            {c.shortcut && <kbd>{shortcutLabel(c.shortcut)}</kbd>}
          </div>
        ))}
      </div>
      {!results.length && (
        <p className="palette-empty">
          No matching commands. Try a tool name or the part you want to change.
        </p>
      )}
      <div className="palette-help" id={hintId}>
        <span>↑ ↓ choose · Enter run · Esc close</span>
        {active && (
          <code title="Type this key in the palette to find this command">
            {":" + active.key}
          </code>
        )}
      </div>
    </Modal>
  );
}
