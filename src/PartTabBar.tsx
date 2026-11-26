import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Box, Boxes, Combine, Layers3, Nut, Pencil, Plus, Trash2 } from "lucide-react";
import { ContextMenu, menuTrigger, type MenuAnchor } from "./ContextMenu";
import type { PartTab } from "./types";
import "./partTabs.css";

type Props = {
  parts: PartTab[];
  active?: string;
  assembly: boolean;
  onPart: (part?: PartTab) => void;
  onAssembly: () => void;
  onNew: () => void;
  onRename: (part: PartTab) => void;
  threadableIds: string[];
  onThreads: (id: string) => void;
  mergeableIds: string[];
  onMerge: (part: PartTab) => void;
  onDelete: (part: PartTab) => void;
};

export default function PartTabBar({ parts, active, assembly, onPart, onAssembly, onNew, onRename, onDelete, onMerge, mergeableIds, onThreads, threadableIds }: Props) {
  const strip = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; part: PartTab } | null>(null);
  useEffect(() => {
    const row = strip.current;
    const tab = row?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!row || !tab) return;
    const viewport = row.getBoundingClientRect(), target = tab.getBoundingClientRect();
    if (target.left < viewport.left) row.scrollLeft -= viewport.left - target.left;
    if (target.right > viewport.right) row.scrollLeft += target.right - viewport.right;
  }, [active, assembly]);

  function navigate(e: KeyboardEvent<HTMLDivElement>) {
    const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const index = tabs.indexOf(e.target as HTMLButtonElement);
    if (index < 0 || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
    if (["F2", "Backspace", "Delete"].includes(e.key)) {
      e.preventDefault();
      const part = parts.find((p) => p.id === tabs[index].dataset.partId);
      if (part && !e.repeat) {
        if (e.key === "F2") onRename(part);
        else onDelete(part);
      }
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1
      : (index + (e.key === "ArrowLeft" ? -1 : 1) + tabs.length) % tabs.length;
    tabs[next].focus();
    tabs[next].click();
  }

  return <div className="part-documents">
    <button type="button" className="new-part-tab" onClick={onNew} title="New part (Alt+B)" aria-label="New part"><Plus size={15} /><span>New part</span></button>
    <div className="part-tab-scroll" ref={strip} role="tablist" aria-label="Part tabs" onKeyDown={navigate}>
      <button type="button" role="tab" aria-selected={!active && !assembly} tabIndex={!active && !assembly ? 0 : -1} onClick={() => onPart()}><Layers3 size={14}/>All parts</button>
      {parts.map((part) => {
        const selected = part.id === active && !assembly;
        return <button type="button" role="tab" key={part.id} data-part-id={part.id} title={part.name} aria-selected={selected} tabIndex={selected ? 0 : -1}
          onClick={() => onPart(part)} onDoubleClick={() => onRename(part)}
          {...menuTrigger((anchor) => setMenu({ anchor, part }))}><Box size={14}/><span>{part.name}</span></button>;
      })}
      <button type="button" className="assembly-document" role="tab" aria-selected={assembly} tabIndex={assembly ? 0 : -1} onClick={onAssembly}><Boxes size={15}/>Assembly</button>
    </div>
    {menu && <ContextMenu anchor={menu.anchor} title={menu.part.name} onClose={() => setMenu(null)} items={[
      {label:"Open part", icon:Box, run:() => onPart(menu.part)},
      ...(threadableIds.includes(menu.part.id) ? [{label:"Threads", icon:Nut, shortcut:"T", run:() => onThreads(menu.part.id)}] : []),
      ...(mergeableIds.includes(menu.part.id) ? [{label:"Merge parts…", icon:Combine, shortcut:"U", run:() => onMerge(menu.part)}] : []),
      {label:"Rename part", icon:Pencil, shortcut:"F2", run:() => onRename(menu.part)},
      {label:"Open assembly", icon:Boxes, run:onAssembly},
      {label:"Delete part", icon:Trash2, shortcut:"Del", divider:true, danger:true, run:() => onDelete(menu.part)},
    ]}/>}
  </div>;
}
