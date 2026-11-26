import { refreshGuideCheck } from "./penGuide";
import { keepAssemblyItems } from "./assemblyItems";
import { useCallback, useEffect, useRef, useState } from "react";
import { turnedProject } from "./projects";
import {
  openJournal,
  tabConflict,
  type JournalPosition,
  type JournalWrite,
} from "./journalStore";
import type { Project } from "./types";

const saveFailure = "Autosave failed. Retry or save a project file.";
const unavailable =
  "Autosave unavailable. Save a project file to keep your edits.";

export function useJournal() {
  const [position, setPosition] = useState<JournalPosition>(() => ({
    project: turnedProject(),
    index: 0,
    last: 0,
  }));
  const active = useRef(position);
  const db = useRef<Awaited<ReturnType<typeof openJournal>> | null>(null);
  const cache = useRef(new Map<number, Project>());
  const writes = useRef<JournalWrite[]>([]),
    writing = useRef<Promise<void> | null>(null);
  const conflicted = useRef(false),
    alive = useRef(false);
  const navigation = useRef(0),
    desired = useRef(0);
  const [saveState, setSaveState] = useState("Opening local project"),
    [ready, setReady] = useState(false);

  const remember = useCallback((index: number, project: Project) => {
    const recent = cache.current;
    recent.delete(index);
    recent.set(index, project);
    // Older persisted revisions can be loaded on demand. Unsaved revisions stay in the write queue.
    if (recent.size > 24) recent.delete(recent.keys().next().value!);
  }, []);
  const show = useCallback(
    (next: JournalPosition) => {
      active.current = next;
      desired.current = next.index;
      remember(next.index, next.project);
      setPosition(next);
    },
    [remember],
  );
  const flush = useCallback(() => {
    if (
      writing.current ||
      conflicted.current ||
      !db.current ||
      !writes.current.length
    )
      return;
    const store = db.current;
    setSaveState("Saving…");
    const task = async () => {
      try {
        while (alive.current && writes.current.length) {
          await store.write(writes.current[0]);
          writes.current.shift();
        }
        if (alive.current) setSaveState("Saved locally");
      } catch (e) {
        conflicted.current = e instanceof Error && e.message === tabConflict;
        if (alive.current)
          setSaveState(conflicted.current ? tabConflict : saveFailure);
      } finally {
        writing.current = null;
      }
    };
    writing.current = task();
  }, []);
  useEffect(() => {
    let disposed = false;
    alive.current = true;
    let store: Awaited<ReturnType<typeof openJournal>> | undefined;
    (async () => {
      store = await openJournal();
      const existing = await store.load();
      if (disposed) {
        store.close();
        return;
      }
      db.current = store;
      if (existing) show(existing);
      else {
        remember(0, active.current.project);
        writes.current.push({ index: 0, project: active.current.project });
      }
      setSaveState("Saved locally");
      setReady(true);
      flush();
    })().catch(() => {
      store?.close();
      if (!disposed) {
        remember(0, active.current.project);
        writes.current.push({ index: 0, project: active.current.project });
        setSaveState(unavailable);
        setReady(true);
      }
    });
    return () => {
      disposed = true;
      alive.current = false;
      db.current = null;
      store?.close();
    };
  }, [show, remember, flush]);
  const publish = useCallback(
    (next: JournalPosition, project: Project | null) => {
      show(next);
      writes.current.push({ index: next.index, project });
      if (!db.current) setSaveState(unavailable);
      else flush();
    },
    [show, flush],
  );
  const commit = useCallback(
    (project: Project) => {
      const old = active.current;
      if (project === old.project) return project;
      ++navigation.current;
      const index = old.index + 1;
      for (const n of cache.current.keys())
        if (n >= index) cache.current.delete(n);
      const next = refreshGuideCheck(
        old.project,
        keepAssemblyItems(old.project, project),
      );
      publish({ project: next, index, last: index }, next);
      return next;
    },
    [publish],
  );
  const step = useCallback(
    (by: number) => {
      const index = desired.current + by;
      if (index < 0 || index > active.current.last) return;
      desired.current = index;
      const token = ++navigation.current;
      const navigate = (project: Project) =>
        publish({ project, index, last: active.current.last }, null);
      let cached = cache.current.get(index);
      if (!cached) {
        // Pending operations are ordered. A write below this index discarded the earlier redo branch.
        for (let i = writes.current.length - 1; i >= 0; i--) {
          const w = writes.current[i];
          if (w.project && w.index <= index) {
            if (w.index === index) cached = w.project;
            break;
          }
        }
      }
      if (cached) {
        navigate(cached);
        return;
      }
      const store = db.current;
      if (!store) {
        desired.current = active.current.index;
        return;
      }
      (async () => {
        try {
          if (writing.current) await writing.current;
          if (token !== navigation.current || !alive.current) return;
          const project = await store.read(index);
          if (token === navigation.current && alive.current) navigate(project);
        } catch (e) {
          if (token !== navigation.current || !alive.current) return;
          desired.current = active.current.index;
          if (e instanceof Error && e.message === tabConflict) {
            conflicted.current = true;
            setSaveState(tabConflict);
          } else
            setSaveState(
              "This undo revision could not be opened. Your current project is still available.",
            );
        }
      })();
    },
    [publish],
  );
  return {
    project: position.project,
    commit,
    step,
    ready,
    saveState,
    retrySave: saveState === saveFailure ? flush : undefined,
    canUndo: position.index > 0,
    canRedo: position.index < position.last,
  };
}
