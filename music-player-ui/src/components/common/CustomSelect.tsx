import { CSSProperties, KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import './CustomSelect.css';
import { BRAND } from '../../config/brand';

interface SelectOption { value: string; label: string }
interface CustomSelectProps {
  label: string;
  value: string | number;
  options: readonly SelectOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
}

export function CustomSelect({ label, value, options, disabled, onChange }: CustomSelectProps) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const [active, setActive] = useState(0), [position, setPosition] = useState<CSSProperties>({});
  const typeAhead = useRef({ text: '', time: 0 });
  const filtered = options.filter(option => option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const selected = options.find(option => option.value === String(value));
  const close = (focus = false) => { setOpen(false); setQuery(''); if (focus) trigger.current?.focus(); };
  const reveal = (last = false) => {
    setQuery('');
    setActive(last ? options.length - 1 : Math.max(0, options.findIndex(option => option.value === String(value))));
    setOpen(true);
  };
  const choose = (option: SelectOption) => { onChange(option.value); close(true); };

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const place = () => {
      const button = trigger.current!;
      const rect = button.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 16, above = rect.top - 16;
      const flip = below < 180 && above > below;
      const width = Math.min(Math.max(rect.width, 240), window.innerWidth - 24);
      const styles = getComputedStyle(button);
      const background = styles.getPropertyValue('--bg-sidebar').trim() || '#202124';
      setPosition({ width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        ...(flip ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }),
        maxHeight: Math.max(80, Math.min(360, flip ? above : below)),
        '--select-surface': background, '--select-text': styles.color,
        '--select-accent': styles.getPropertyValue('--theme-color').trim() || BRAND.accent,
      } as CSSProperties & Record<`--${string}`, string>);
    };
    place();
    const scroll = (event: Event) => {
      if (popup.current?.contains(event.target as Node)) return;
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect || rect.bottom <= 0 || rect.top >= window.innerHeight) close();
      else place();
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', scroll, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', scroll, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) close();
    };
    const blur = (event: FocusEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', blur);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', blur); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    popup.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);
  const keyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
    if (event.key === 'Tab') { close(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) reveal(event.key === 'ArrowUp');
      else setActive(index => Math.max(0, Math.min(filtered.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
    } else if (event.key === 'Home' || event.key === 'End') {
      if (!open) return;
      event.preventDefault(); setActive(event.key === 'Home' ? 0 : Math.max(0, filtered.length - 1));
    } else if (event.key === 'Enter' || (event.key === ' ' && event.target === trigger.current)) {
      event.preventDefault();
      if (!open) reveal(); else if (filtered[active]) choose(filtered[active]);
    } else if (event.target === trigger.current && event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const now = performance.now();
      typeAhead.current.text = (now - typeAhead.current.time < 600 ? typeAhead.current.text : '') + event.key;
      typeAhead.current.time = now;
      const index = options.findIndex(option => option.label.toLocaleLowerCase().startsWith(typeAhead.current.text.toLocaleLowerCase()));
      if (index >= 0) { setQuery(''); setActive(index); setOpen(true); }
    }
  };
  return <>
    <button ref={trigger} type="button" role="combobox" aria-label={label} aria-haspopup="listbox"
      aria-expanded={open} aria-controls={open ? id : undefined} aria-activedescendant={open && filtered[active] ? `${id}-${active}` : undefined}
      className="custom-select-trigger" disabled={disabled} onKeyDown={keyboard} onClick={() => open ? close() : reveal()}>
      <span title={selected?.label}>{selected?.label || 'Select'}</span><ChevronDown size={16} className={open ? 'open' : ''} />
    </button>
    {open && createPortal(<div ref={popup} className="custom-select-popup" style={position} onKeyDown={keyboard}>
      {options.length > 8 && <div className="custom-select-search"><Search size={15} />
        <input aria-label={`Search ${label}`} value={query} placeholder="Search"
          onChange={event => { setQuery(event.target.value); setActive(0); }} /></div>}
      <div id={id} role="listbox" aria-label={label} className="custom-select-options">
        {filtered.map((option, index) => <div id={`${id}-${index}`} key={option.value} role="option"
          aria-selected={option.value === String(value)} data-index={index}
          className={'custom-select-option' + (index === active ? ' focused' : '')}
          onPointerMove={() => setActive(index)} onPointerDown={event => event.preventDefault()} onClick={() => choose(option)}>
          <span>{option.label}</span>{option.value === String(value) && <Check size={16} />}
        </div>)}
        {!filtered.length && <div className="custom-select-empty">No matches</div>}
      </div>
    </div>, document.body)}
  </>;
}
