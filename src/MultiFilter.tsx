import { useEffect, useRef, useState } from 'react';

export interface MultiFilterProps {
  title: string;
  hint?: string;
  options: [string, string][];
  selected: string[];
  onToggle: (value: string) => void;
  searchable?: boolean;
}

export function MultiFilter({
  title,
  hint,
  options,
  selected,
  onToggle,
  searchable = false,
}: MultiFilterProps) {
  const [search, setSearch] = useState('');
  const details = useRef<HTMLDetailsElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  function positionMenu() {
    if (!details.current?.open || !menu.current) return;
    if (window.innerWidth <= 850) {
      menu.current.style.left = '';
      return;
    }
    const anchor = details.current.getBoundingClientRect();
    const width = menu.current.offsetWidth;
    const left = Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12));
    menu.current.style.left = `${left - anchor.left}px`;
  }

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (details.current?.open && !details.current.contains(event.target as Node)) {
        details.current.open = false;
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && details.current?.open) details.current.open = false;
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', positionMenu);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', positionMenu);
    };
  }, []);

  const visible = searchable
    ? options.filter(([, label]) =>
        label.toLocaleLowerCase('it').includes(search.toLocaleLowerCase('it')),
      )
    : options;

  return (
    <details
      className="multi-filter"
      ref={details}
      onToggle={(event) => {
        if (event.currentTarget.open) requestAnimationFrame(positionMenu);
      }}
    >
      <summary>
        {title}
        {selected.length > 0 && <span className="filter-count">{selected.length}</span>}
      </summary>
      <div className="multi-filter-menu" ref={menu}>
        {hint && <p className="filter-hint">{hint}</p>}
        {searchable && (
          <input
            aria-label={`Cerca ${title.toLocaleLowerCase('it')}`}
            placeholder="Cerca…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        )}
        {visible.length ? (
          visible.map(([value, label]) => (
            <label key={value}>
              <input
                type="checkbox"
                checked={selected.includes(value)}
                onChange={() => onToggle(value)}
              />
              <span>{label}</span>
            </label>
          ))
        ) : (
          <p>Nessuna opzione disponibile</p>
        )}
      </div>
    </details>
  );
}
