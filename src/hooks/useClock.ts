import { useEffect, useState } from 'react';
import { clock } from '../lib/format';

const now = () => `${clock()} · ${new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}`;

/** "11:19 · Tue 22 Sept", refreshed every 15s. */
export function useClock(): string {
  const [text, setText] = useState(now);
  useEffect(() => {
    const id = setInterval(() => setText(now()), 15000);
    return () => clearInterval(id);
  }, []);
  return text;
}
