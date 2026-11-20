// A small, dependency-free emoji picker: a curated grid with roving focus.
// Arrow keys move, Home/End jump, Enter/Space inserts, Escape closes and returns focus.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Smile } from 'lucide-react';

const EMOJI: Array<[string, string]> = [
  ['😀', 'grinning face'], ['😂', 'tears of joy'], ['🤣', 'rolling on the floor laughing'], ['😊', 'smiling face'],
  ['😍', 'heart eyes'], ['😘', 'blowing a kiss'], ['😎', 'sunglasses'], ['🤩', 'star struck'],
  ['🥳', 'party face'], ['😇', 'halo'], ['🙂', 'slight smile'], ['😉', 'wink'],
  ['😅', 'sweat smile'], ['😬', 'grimace'], ['🤔', 'thinking'], ['🙄', 'eye roll'],
  ['😴', 'sleeping'], ['🥱', 'yawning'], ['😋', 'yum'], ['🤤', 'drooling'],
  ['😭', 'crying'], ['😢', 'tear'], ['😡', 'angry'], ['😱', 'screaming'],
  ['🤯', 'mind blown'], ['🥲', 'smiling with tear'], ['🤗', 'hug'], ['🤝', 'handshake'],
  ['👍', 'thumbs up'], ['👎', 'thumbs down'], ['👌', 'okay'], ['🙏', 'folded hands'],
  ['👏', 'clapping'], ['🙌', 'raised hands'], ['💪', 'flexed biceps'], ['👋', 'wave'],
  ['❤️', 'red heart'], ['🧡', 'orange heart'], ['💯', 'hundred'], ['🔥', 'fire'],
  ['✨', 'sparkles'], ['🎉', 'party popper'], ['✅', 'check mark'], ['❌', 'cross mark'],
  ['⏰', 'alarm clock'], ['🏠', 'house'], ['🛒', 'shopping cart'], ['🧺', 'laundry basket'],
  ['👕', 't-shirt'], ['🍛', 'curry rice'], ['🍚', 'cooked rice'], ['🥘', 'pan of food'],
  ['🍳', 'cooking'], ['🌶️', 'chili pepper'], ['🥚', 'egg'], ['🍕', 'pizza'],
  ['☕', 'coffee'], ['🍵', 'tea'], ['🥤', 'cup with straw'], ['🍰', 'cake'],
  ['🌙', 'moon'], ['💡', 'light bulb'], ['🎂', 'birthday cake'], ['🏏', 'cricket'],
];
const COLS = 8;

export function EmojiPicker({ onPick, disabled }: { onPick: (emoji: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    cellRefs.current[active]?.focus();
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    toggleRef.current?.focus();
  };

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = EMOJI.length;
    let next = active;
    switch (e.key) {
      case 'ArrowRight': next = (active + 1) % n; break;
      case 'ArrowLeft': next = (active - 1 + n) % n; break;
      case 'ArrowDown': next = Math.min(active + COLS, n - 1); break;
      case 'ArrowUp': next = Math.max(active - COLS, 0); break;
      case 'Home': next = 0; break;
      case 'End': next = n - 1; break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      case 'Tab':
        setOpen(false);
        return;
      default:
        return;
    }
    e.preventDefault();
    setActive(next);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={toggleRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={open ? 'Close emoji' : 'Add emoji'}
        className={`grid size-10 place-items-center rounded-full text-dusk transition-colors hover:bg-wall hover:text-jasmine disabled:opacity-50 ${open ? 'bg-wall text-lamp' : ''}`}
      >
        <Smile className="size-5" aria-hidden />
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Emoji"
          className="absolute bottom-12 left-0 z-30 w-[min(20rem,calc(100vw-2rem))] rounded-tile border border-seam bg-room p-2 shadow-[0_18px_50px_-20px_rgb(0_0_0/0.8)]"
        >
          <div role="group" aria-label="Pick an emoji, arrow keys move" onKeyDown={onGridKey} className="grid grid-cols-8 gap-0.5">
            {EMOJI.map(([emoji, label], i) => (
              <button
                key={emoji}
                ref={(el) => {
                  cellRefs.current[i] = el;
                }}
                type="button"
                tabIndex={i === active ? 0 : -1}
                aria-label={label}
                title={label}
                onFocus={() => setActive(i)}
                onClick={() => onPick(emoji)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPick(emoji);
                  }
                }}
                className="grid aspect-square place-items-center rounded-chip text-xl leading-none hover:bg-wall focus-visible:bg-wall"
              >
                <span aria-hidden>{emoji}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
