import { validateProject } from "./projects";
import type { Project } from "./types";

export type JournalPosition = { project: Project; index: number; last: number };
export type JournalWrite = { index: number; project: Project | null };
export const tabConflict =
  "Another tab saved a newer revision. Save a project file to keep your edits.";

// Version 1 already stores each snapshot under its integer undo position.
export async function openJournal() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open("turnmill-projects", 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore("journal");
      open.result.createObjectStore("state");
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  let revision = 0;
  function load() {
    return new Promise<JournalPosition | null>((resolve, reject) => {
      const tx = db.transaction(["journal", "state"]);
      const meta = tx.objectStore("state"),
        journal = tx.objectStore("journal");
      const version = meta.get("revision"),
        cursor = meta.get("cursor"),
        last = journal.openKeyCursor(null, "prev");
      let current: IDBRequest | undefined;
      cursor.onsuccess = () => {
        if (Number.isSafeInteger(cursor.result) && cursor.result >= 0)
          current = journal.get(cursor.result);
      };
      tx.oncomplete = () => {
        try {
          revision = version.result || 0;
          if (!last.result) {
            resolve(null);
            return;
          }
          const end = last.result.key;
          if (!current || typeof end !== "number" || cursor.result > end)
            throw Error("The saved undo position could not be read.");
          resolve({
            project: validateProject(current.result),
            index: cursor.result,
            last: end,
          });
        } catch (e) {
          reject(e);
        }
      };
      tx.onabort = () => reject(tx.error);
    });
  }
  function read(index: number) {
    return new Promise<Project>((resolve, reject) => {
      const tx = db.transaction(["journal", "state"]);
      const version = tx.objectStore("state").get("revision"),
        row = tx.objectStore("journal").get(index);
      tx.oncomplete = () => {
        try {
          if ((version.result || 0) !== revision) throw Error(tabConflict);
          resolve(validateProject(row.result));
        } catch (e) {
          reject(e);
        }
      };
      tx.onabort = () => reject(tx.error);
    });
  }
  function write({ index, project }: JournalWrite) {
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["journal", "state"], "readwrite");
      const meta = tx.objectStore("state"),
        version = meta.get("revision");
      let conflict = false;
      version.onsuccess = () => {
        if ((version.result || 0) !== revision) {
          conflict = true;
          tx.abort();
          return;
        }
        if (project) {
          const rows = tx.objectStore("journal");
          rows.delete(IDBKeyRange.lowerBound(index));
          rows.put(project, index);
        }
        meta.put(index, "cursor");
        meta.put(revision + 1, "revision");
      };
      tx.oncomplete = () => {
        revision++;
        resolve();
      };
      tx.onabort = () => reject(conflict ? Error(tabConflict) : tx.error);
    });
  }
  return { load, read, write, close: () => db.close() };
}
