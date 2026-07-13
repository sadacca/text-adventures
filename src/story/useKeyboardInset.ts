import { useEffect, useState } from 'react';

/**
 * Task 1.7: "keep the input visible above the keyboard using the visualViewport API."
 * On Android Chrome, a focused text input triggers the soft keyboard, which shrinks
 * `window.visualViewport` without changing `window.innerHeight` — the layout viewport
 * still thinks it has the full screen, so a naturally-flowed bottom bar ends up
 * underneath the keyboard. Returns the number of px currently hidden behind the
 * keyboard (0 when it's closed), for the caller to apply as bottom padding/transform.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const hidden = window.innerHeight - vv.height - vv.offsetTop;
      setInset(Math.max(0, Math.round(hidden)));
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
