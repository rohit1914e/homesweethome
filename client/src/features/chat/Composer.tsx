// Message composer: auto-growing textarea, Enter to send (Shift+Enter for a new line;
// on touch screens Enter is a new line and the send button sends), emoji at the caret,
// and throttled typing signals.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { SendHorizontal } from 'lucide-react';
import { getSocket } from '@/lib/socket';
import { CHAT_MAX_LENGTH } from './chatStore';
import { EmojiPicker } from './EmojiPicker';

const TYPING_THROTTLE_MS = 2_000;
const TYPING_IDLE_MS = 3_000;
const MAX_ROWS_PX = 160;
const COUNTER_FROM = CHAT_MAX_LENGTH - 200;

function useTypingSignal() {
  const typing = useRef(false);
  const lastSent = useRef(0);
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const stop = useCallback(() => {
    if (idle.current) clearTimeout(idle.current);
    idle.current = undefined;
    if (typing.current) {
      typing.current = false;
      getSocket().emit('chat:typing', { typing: false });
    }
  }, []);

  const ping = useCallback(() => {
    const now = Date.now();
    if (!typing.current || now - lastSent.current >= TYPING_THROTTLE_MS) {
      typing.current = true;
      lastSent.current = now;
      getSocket().emit('chat:typing', { typing: true });
    }
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(stop, TYPING_IDLE_MS);
  }, [stop]);

  useEffect(() => stop, [stop]);
  return { ping, stop };
}

export function Composer({ onSend, onFocus }: { onSend: (body: string) => boolean; onFocus?: () => void }) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const pendingCaret = useRef<number | null>(null);
  const { ping, stop } = useTypingSignal();
  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && trimmed.length <= CHAT_MAX_LENGTH;

  // Grow with content up to a cap, then scroll inside.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_PX)}px`;
    if (pendingCaret.current !== null) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      caret.current = { start: pendingCaret.current, end: pendingCaret.current };
      pendingCaret.current = null;
    }
  }, [value]);

  const remember = () => {
    const el = ref.current;
    if (el) caret.current = { start: el.selectionStart, end: el.selectionEnd };
  };

  const submit = () => {
    if (!canSend) return;
    if (onSend(value)) {
      setValue('');
      caret.current = { start: 0, end: 0 };
      stop();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
    if (touch) return; // newline; the send button sends
    e.preventDefault();
    submit();
  };

  const insertEmoji = (emoji: string) => {
    const { start, end } = caret.current;
    const next = value.slice(0, start) + emoji + value.slice(end);
    if (next.length > CHAT_MAX_LENGTH) return;
    pendingCaret.current = start + emoji.length;
    caret.current = { start: start + emoji.length, end: start + emoji.length };
    setValue(next);
    ping();
  };

  const left = CHAT_MAX_LENGTH - value.length;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex items-end gap-1.5 rounded-[1.5rem] border border-seam bg-room p-1.5 focus-within:border-lamp/60"
    >
      <EmojiPicker onPick={insertEmoji} />
      <label htmlFor="chat-input" className="sr-only">
        Message the room
      </label>
      <textarea
        id="chat-input"
        ref={ref}
        rows={1}
        value={value}
        maxLength={CHAT_MAX_LENGTH}
        placeholder="Message the room"
        enterKeyHint="enter"
        autoComplete="off"
        onChange={(e) => {
          setValue(e.target.value);
          caret.current = { start: e.target.selectionStart, end: e.target.selectionEnd };
          if (e.target.value.trim()) ping();
          else stop();
        }}
        onKeyDown={onKeyDown}
        onSelect={remember}
        onKeyUp={remember}
        onClick={remember}
        onFocus={onFocus}
        onBlur={() => {
          remember();
          stop();
        }}
        aria-describedby={left <= CHAT_MAX_LENGTH - COUNTER_FROM ? 'chat-counter' : undefined}
        className="min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-[15px] leading-6 text-jasmine placeholder:text-haze focus:outline-none"
      />
      {value.length >= COUNTER_FROM && (
        <span
          id="chat-counter"
          aria-live="polite"
          className={`self-center px-1 text-xs tabular-nums ${left <= 20 ? 'text-chili' : 'text-dusk'}`}
        >
          {left} left
        </span>
      )}
      <button
        type="submit"
        disabled={!canSend}
        aria-label="Send message"
        className="grid size-10 shrink-0 place-items-center rounded-full bg-lamp text-lamp-ink transition-[transform,opacity] duration-150 active:scale-95 disabled:bg-wall disabled:text-haze"
      >
        <SendHorizontal className="size-5" aria-hidden />
      </button>
    </form>
  );
}
