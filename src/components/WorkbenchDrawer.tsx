import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

let openDrawers = 0;
let originalOverflow = '';
const drawerStack:HTMLDivElement[]=[];

export function WorkbenchDrawer({ title, onClose, children, wide = false, bodyClassName = '', closeLabel }: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; bodyClassName?: string; closeLabel?:string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (openDrawers++ === 0) { originalOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    const current=panel.current; if(current)drawerStack.push(current);
    panel.current?.focus();
    const key = (event: KeyboardEvent) => {
      if(drawerStack.at(-1)!==panel.current)return;
      if (event.key === 'Escape') { event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const elements = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary') || []).filter(el => el.getClientRects().length);
      const first = elements[0], last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); if(current){const index=drawerStack.indexOf(current);if(index>=0)drawerStack.splice(index,1);} if (--openDrawers === 0) document.body.style.overflow = originalOverflow; previous?.focus(); };
  }, []);
  return <div className="wb-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`wb-drawer ${wide ? 'wb-drawer-wide' : ''}`}>
      <header className="wb-drawer-header"><h2>{title}</h2><button className="wb-icon" aria-label={closeLabel || `关闭${title}`} onClick={onClose}><X size={20} /></button></header>
      <div className={`wb-drawer-body ${bodyClassName}`}>{children}</div>
    </div>
  </div>;
}
