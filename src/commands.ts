export type Command = {
  title: string;
  group: string;
  run: () => void;
  key?: string;
  shortcut?: string;
  keywords?: string;
  disabled?: boolean;
  reason?: string;
};

export type SearchableCommand = Command & { key: string; alias: string };
export type PaletteContext = {
  root: HTMLElement;
  opener: Element | null;
  initialQuery?: string;
};
export type Workspace = "Part" | "Assembly" | "Drawing" | "Scales";

const plain = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const slug = (text: string) => plain(text).replaceAll(" ", "-");
const clean = (text: string) => text.replace(/\s+/g, " ").trim();

const synonyms: [RegExp, string][] = [
  [/new project/, "create blank start template starter"],
  [/save project/, "backup native Turnmill project file"],
  [/revolve/, "lathe turn turning spin rotational body"],
  [/extrude/, "extrusion pull push prism"],
  [/fillet/, "round rounded edge radius"],
  [/chamfer/, "bevel deburr edge"],
  [/axial hole/, "drill drilling bore counterbore countersink through blind"],
  [/add thread/, "tap tapping die helix helical screw thread pitch"],
  [/surface mark/, "engrave etch text engraving emboss lettering logo graphic"],
  [
    /named parameters/,
    "variables dimensions equations formulas parameter table",
  ],
  [/mating fits/, "ISO 286 tolerance H7 g6 allowance"],
  [/full travel/, "sweep motion range interference collision clearance cap"],
  [/check pose/, "check interference collision clearance gap distance"],
  [/bill of materials/, "BOM parts list components quantities"],
  [/download pdf/, "print drawing document vector manufacturing sheet"],
  [
    /drawing workspace/,
    "drafting blueprints manufacturing drawing shop drawings",
  ],
  [/scales workspace/, "ruler graduations ticks laser engraving"],
  [/assembly workspace/, "assemble mechanism joints mates movement"],
  [/add dimension/, "measure length distance dimension tolerance"],
  [
    /pen walkthrough|guided pen/,
    "tutorial guide start learn onboarding beginner",
  ],
];

export function commandKey(title: string) {
  return slug(title.replace(/\s*\(\d+\)\s*$/, ""));
}

export function shortcutLabel(shortcut: string) {
  if (
    typeof navigator === "undefined" ||
    !/Mac|iPhone|iPad/.test(navigator.platform)
  )
    return shortcut
      .replaceAll("⌘ ", "Ctrl+")
      .replaceAll("⇧ ", "Shift+")
      .replace(/^Alt /, "Alt+");
  return shortcut;
}

export function openPaletteContext(initialQuery = ""): PaletteContext | null {
  const opener = document.activeElement;
  const root =
    opener?.closest<HTMLElement>("dialog[open],.sk-dialog") ??
    [...document.querySelectorAll<HTMLElement>("dialog[open],.sk-dialog")].at(
      -1,
    ) ??
    document.querySelector<HTMLElement>(".tm-app");
  return root ? { root, opener, initialQuery } : null;
}

const controlSelector =
  "button,summary,input:not([type=hidden]):not([type=file]),select,textarea,a[href],[role=button]";
function labelText(el: Element) {
  const copy = el.cloneNode(true) as Element;
  copy
    .querySelectorAll("input,select,textarea,kbd,svg,small,[aria-hidden=true]")
    .forEach((n) => n.remove());
  return clean(copy.textContent || "");
}
function nameOf(el: Element) {
  const aria = el.getAttribute("aria-label");
  if (aria) return clean(aria);
  const labelled = el.getAttribute("aria-labelledby");
  if (labelled) {
    const text = labelled
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || "")
      .join(" ")
      .trim();
    if (text) return clean(text);
  }
  if (el.matches("input,select,textarea")) {
    const field = el as HTMLInputElement;
    const label = field.labels?.[0] || el.closest("label");
    if (label) return labelText(label);
  }
  return (
    labelText(el) ||
    clean(el.getAttribute("title") || el.getAttribute("placeholder") || "")
  );
}
function detailsOf(el: Element) {
  const out: HTMLDetailsElement[] = [];
  for (let p = el.parentElement; p; p = p.parentElement)
    if (
      p instanceof HTMLDetailsElement &&
      p.querySelector(":scope > summary") !== el
    )
      out.unshift(p);
  return out;
}
function available(el: Element) {
  return (
    el.isConnected &&
    !el.matches(":disabled,[aria-disabled=true]") &&
    !el.closest("[inert]")
  );
}
function reachable(el: Element) {
  if (
    el.closest(
      ".command-palette,[hidden],[inert],[aria-hidden=true],.offscreen",
    )
  )
    return false;
  if (getComputedStyle(el).visibility === "hidden") return false;
  if (el.getClientRects().length) return true;
  // Descendants of a collapsed disclosure belong in search. CSS-hidden panels do not.
  let collapsed = false;
  for (let p: Element | null = el; p; p = p.parentElement) {
    if (getComputedStyle(p).display === "none") return false;
    if (p instanceof HTMLDetailsElement && !p.open) collapsed = true;
  }
  return collapsed;
}

function focusControl(el: Element) {
  detailsOf(el).forEach((d) => {
    d.open = true;
  });
  if (el instanceof HTMLElement || el instanceof SVGElement) el.focus();
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
  if (
    el instanceof HTMLInputElement &&
    ["text", "search", "number", "url"].includes(el.type)
  )
    el.select();
  if (el instanceof HTMLTextAreaElement) el.select();
}
function disabledReason(el: Element, root: HTMLElement, name: string) {
  const reason = el.getAttribute("data-disabled-reason");
  if (reason) return reason;
  const message =
    el.closest("form,dialog")?.querySelector('[role="alert"]') ||
    el
      .closest(".tm-workspace")
      ?.querySelector(".tm-paper-stage .tm-empty,.tm-inline-error");
  if (message?.textContent?.trim()) return clean(message.textContent);
  if (name === "Full travel" || name === "Animate" || name === "Record")
    return "Choose a movable component with valid joint limits and wait for the assembly to rebuild.";
  if (name === "Check pose")
    return "Choose a comparison body and wait for the assembly to rebuild.";
  const hint = el.getAttribute("title");
  if (hint && hint !== name) return hint;
  return root.matches("dialog,.sk-dialog")
    ? "Complete the current dialog inputs to enable this action."
    : undefined;
}
function activate(el: Element) {
  if (!available(el)) return;
  focusControl(el);
  if (
    el.matches(
      "button,summary,a,[role=button],input[type=checkbox],input[type=radio]",
    )
  ) {
    if (el instanceof HTMLElement) el.click();
    else el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
}

export function surfaceCommands(
  known: Command[],
  root: HTMLElement,
  mode: Workspace,
): SearchableCommand[] {
  const scoped = root.matches("dialog,.sk-dialog");
  const commands: Command[] = scoped ? [] : [...known];
  const coreTitles = new Set(commands.map((c) => plain(c.title)));
  const group = scoped ? root.getAttribute("aria-label") || "Dialog" : mode;
  for (const el of root.querySelectorAll(controlSelector)) {
    if (!reachable(el)) continue;
    const name = nameOf(el);
    if (!name || name === "Open command palette") continue;
    const field = el.matches("input,select,textarea");
    const toggle = el.matches("input[type=checkbox],input[type=radio]");
    const title = (field && !toggle ? "Edit " : "") + name;
    if (!scoped && coreTitles.has(plain(title))) continue;
    const trail = detailsOf(el)
      .map((d) => d.querySelector(":scope > summary")?.textContent?.trim())
      .filter(Boolean)
      .join(" / ");
    const description = el.getAttribute("title") || "";
    const options =
      el instanceof HTMLSelectElement
        ? [...el.options].map((o) => o.text).join(" ")
        : "";
    const stableKey = el.getAttribute("data-command-key");
    const disabled = !available(el);
    commands.push({
      title,
      group: trail ? group + " · " + trail : group,
      key: stableKey || commandKey(title),
      keywords: [description, options, stableKey].filter(Boolean).join(" "),
      disabled,
      reason: disabled ? disabledReason(el, root, name) : undefined,
      run: () => activate(el),
    });
  }
  // Repeated controls keep their context. For example both page views can contain a size field.
  const counts = new Map<string, number>();
  const reserved = new Set(
    commands
      .filter((c) => c.key || c.title)
      .map((c) => c.key || commandKey(c.title)),
  );
  const used = new Set<string>();
  return commands.map((c, i) => {
    const base = c.key || commandKey(c.title);
    let key = base;
    if (used.has(base)) {
      const detail = c.group.split(" · ").slice(1).join(" ");
      const prefix = detail ? base + "-" + commandKey(detail) : base;
      key = prefix;
      let n = counts.get(prefix) || 1;
      while (used.has(key) || reserved.has(key)) key = prefix + "-" + ++n;
      counts.set(prefix, n);
    }
    used.add(key);
    const extra = synonyms
      .filter(([pattern]) => pattern.test(plain(c.title)))
      .map(([, words]) => words);
    return {
      ...c,
      key,
      alias: String(i + 1).padStart(2, "0"),
      keywords: [c.keywords, ...extra].filter(Boolean).join(" "),
    };
  });
}

function similar(a: string, b: string) {
  // One insertion, substitution, deletion, or adjacent transposition.
  if (Math.abs(a.length - b.length) > 1 || a.length < 4) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length)
    return (
      a.slice(i + 1) === b.slice(i + 1) ||
      (a[i] === b[i + 1] &&
        a[i + 1] === b[i] &&
        a.slice(i + 2) === b.slice(i + 2))
    );
  return a.length > b.length
    ? a.slice(i + 1) === b.slice(i)
    : a.slice(i) === b.slice(i + 1);
}
export function searchCommands(
  commands: SearchableCommand[],
  input: string,
  recent: readonly string[] = [],
) {
  const query = input.trim().toLowerCase();
  if (/^#?\d+$/.test(query))
    return commands.filter((c) => +c.alias === Number(query.replace("#", "")));
  if (query.startsWith(":")) {
    const key = slug(query.slice(1));
    return commands
      .filter((c) => c.key.startsWith(key))
      .sort((a, b) => Number(b.key === key) - Number(a.key === key));
  }
  const allTokens = plain(query).split(" ").filter(Boolean);
  const terms = allTokens.filter(
    (t) =>
      ![
        "a",
        "an",
        "the",
        "my",
        "to",
        "of",
        "for",
        "how",
        "do",
        "i",
        "make",
        "please",
      ].includes(t),
  );
  const tokens = terms.length ? terms : allTokens;
  const scored = commands.map((c, i) => {
    const title = plain(c.title),
      group = plain(c.group),
      words = title.split(" "),
      extra = plain(c.keywords || "").split(" ");
    let score = 0;
    for (const token of tokens) {
      const part = words.includes(token)
        ? 18
        : words.some((w) => w.startsWith(token))
          ? 14
          : extra.includes(token)
            ? 12
            : title.includes(token)
              ? 10
              : group.includes(token)
                ? 7
                : extra.some((w) => w.startsWith(token))
                  ? 6
                  : words.some((w) => similar(token, w))
                    ? 5
                    : extra.some((w) => similar(token, w))
                      ? 3
                      : 0;
      if (!part) return { c, i, score: -Infinity };
      score += part;
    }
    const r = recent.indexOf(c.key);
    if (r >= 0) score += tokens.length ? 2 : 100 - r;
    if (tokens.length) {
      if (title === tokens.join(" ")) score += 50;
      else if (title.replace(/^(edit |go to )/, "") === tokens.join(" "))
        score += 42;
      else if (title.startsWith(tokens.join(" "))) score += 20;
    } else if (
      [
        "New sketch",
        "Named parameters",
        "Revolve profile",
        "Add dimension",
        "Full travel",
        "Export DXF",
        "Pen walkthrough",
      ].includes(c.title)
    )
      score += 12;
    if (c.disabled) score -= tokens.length ? 2 : 40;
    return { c, i, score };
  });
  return scored
    .filter((v) => Number.isFinite(v.score))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((v) => v.c);
}

export function keyBinding(e: KeyboardEvent) {
  if (
    e.isComposing ||
    e.repeat ||
    (e.altKey && (e.metaKey || e.ctrlKey)) ||
    (e.altKey && e.shiftKey)
  )
    return "";
  const key = e.key.toUpperCase();
  if (e.metaKey || e.ctrlKey) return "⌘ " + (e.shiftKey ? "⇧ " : "") + key;
  if (e.altKey)
    return (
      "Alt " +
      (e.code.match(/^(?:Key|Digit)([A-Z0-9])$/)?.[1] ||
        (key === "ARROWUP" ? "↑" : key === "ARROWDOWN" ? "↓" : key))
    );
  return e.shiftKey && key !== "?" ? "" : key;
}

type WorkspaceDestination = {
  mode: Workspace;
  title: string;
  control: string;
  words: string;
  needsPair?: boolean;
  tab?: string;
};
const destinations: WorkspaceDestination[] = [
  {
    mode: "Drawing",
    title: "PDF drawing export",
    control: "Download PDF",
    words: "print sheets manufacturing blueprint",
  },
  {
    mode: "Drawing",
    title: "Drawing dimensions",
    control: "Add dimension",
    words: "annotate measure tolerance distance",
  },
  {
    mode: "Drawing",
    title: "Drawing section plane",
    control: "Section plane",
    words: "cross section cutting plane detail A–A",
  },
  {
    mode: "Drawing",
    title: "Drawing title block",
    control: "Drawing no.",
    words: "revision material shop note title",
  },
  {
    mode: "Drawing",
    title: "Assembly drawing source",
    control: "Drawing source",
    words: "exploded view parts list balloons",
  },
  {
    mode: "Drawing",
    title: "Drawing DXF export",
    control: "Sheet DXF",
    words: "technical draft CAD paper",
  },
  {
    mode: "Assembly",
    title: "Assembly joints",
    control: "Joint",
    words: "mate fixed revolute slider screw helical cylindrical ball planar",
    needsPair: true,
  },
  {
    mode: "Assembly",
    title: "Full travel clearance check",
    control: "Full travel",
    words: "collision interference minimum gap range of motion cap",
    needsPair: true,
  },
  {
    mode: "Assembly",
    title: "Assembly motion",
    control: "Animate",
    words: "animate drive play rotation slider",
    needsPair: true,
  },
  {
    mode: "Assembly",
    title: "Bill of materials",
    control: "Bill of materials",
    words: "parts list BOM csv hardware",
    needsPair: true,
  },
  {
    mode: "Assembly",
    title: "Mating fits",
    control: "Mating fits",
    words: "ISO 286 H7 g6 shaft bore tolerance",
    needsPair: true,
  },
  {
    mode: "Assembly",
    title: "Cam and spring study",
    control: "Cam & spring",
    words: "click pen follower dwell compression preload",
    tab: "Cam & spring",
  },
  {
    mode: "Assembly",
    title: "Coaxial fit study",
    control: "Coaxial fit study",
    words: "coaxial mechanism shaft bore clearance",
    tab: "Coaxial fit study",
  },
  {
    mode: "Scales",
    title: "Ruler graduations",
    control: "Top edge",
    words: "metric imperial fractional ruler inches scale ticks units",
  },
  {
    mode: "Scales",
    title: "Protractor layout",
    control: "Protractor",
    words: "angular degree arc scale",
  },
  {
    mode: "Scales",
    title: "Graduation labels",
    control: "Number labels",
    words: "numbers font typography rotation frequency",
  },
  {
    mode: "Scales",
    title: "Ruler SVG export",
    control: "Export SVG",
    words: "laser engraving artwork vector",
  },
  {
    mode: "Scales",
    title: "Ruler DXF export",
    control: "Export DXF",
    words: "CNC engraving full size tick contours",
  },
];

function findControl(root: Element, name: string) {
  return [...root.querySelectorAll(controlSelector)].find(
    (el) => reachable(el) && nameOf(el).replace(/\s*\(\d+\)$/, "") === name,
  );
}
export function workspaceCommands(
  mode: Workspace,
  bodyCount: number,
  switchMode: (m: Workspace) => void,
  notify: (s: string) => void,
): Command[] {
  return destinations
    .filter((d) => d.mode !== mode)
    .map((d) => ({
      title: "Go to " + d.title,
      group: d.mode,
      keywords: d.words,
      disabled: !!d.needsPair && bodyCount < 2,
      reason: d.needsPair
        ? "Create or insert two active bodies to assemble them."
        : undefined,
      run: () => {
        switchMode(d.mode);
        // Route to the control once React mounts this workspace. Geometry or exports always
        // run through the destination's own control and validation.
        let frame = 0,
          timer = 0;
        const cancel = () => {
          cancelAnimationFrame(frame);
          window.clearTimeout(timer);
          observer.disconnect();
          document.removeEventListener("pointerdown", cancel, true);
          document.removeEventListener("keydown", cancel, true);
        };
        const locate = () => {
          const app = document.querySelector<HTMLElement>(".tm-app");
          if (
            !app ||
            app.dataset.workspace !== d.mode ||
            document.querySelector("dialog[open],.sk-dialog")
          ) {
            cancel();
            return;
          }
          const workspace = app.querySelector(
            d.mode === "Assembly" ? ".mech-space" : ".tm-workspace",
          );
          if (!workspace) return;
          if (d.mode === "Assembly") {
            const tab = findControl(workspace, d.tab || "3D assembly");
            if (
              tab instanceof HTMLButtonElement &&
              !tab.classList.contains("selected")
            ) {
              tab.click();
              return;
            }
          }
          const el = findControl(workspace, d.control);
          cancel();
          if (!el) {
            notify(
              "Open " +
                d.mode +
                " and select a source for " +
                d.title.toLowerCase() +
                ".",
            );
            return;
          }
          if (
            el instanceof HTMLElement &&
            el.matches("summary") &&
            el.parentElement instanceof HTMLDetailsElement
          )
            el.parentElement.open = true;
          focusControl(el);
          if (!available(el))
            notify(
              "Opened " +
                d.mode +
                ". " +
                nameOf(el) +
                " becomes available when its inputs are ready.",
            );
        };
        const observer = new MutationObserver(() => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(locate);
        });
        observer.observe(document.querySelector(".tm-app") || document.body, {
          childList: true,
          subtree: true,
        });
        document.addEventListener("pointerdown", cancel, true);
        document.addEventListener("keydown", cancel, true);
        frame = requestAnimationFrame(locate);
        timer = window.setTimeout(() => {
          cancel();
          notify(
            "Open " + d.mode + " again to find " + d.title.toLowerCase() + ".",
          );
        }, 8000);
      },
    }));
}
