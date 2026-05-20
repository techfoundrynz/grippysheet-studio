import { useEffect, useRef, useState } from 'react';

/**
 * Local-draft + debounced-commit pattern for high-frequency inputs (sliders,
 * spinners) that drive heavy downstream work.
 *
 * `draft` updates immediately so the displayed value (label, slider position)
 * stays smooth while the user is dragging. `commit` fires once after `delayMs`
 * of no further updates — that's when the real settings change happens and
 * the expensive pipeline kicks off.
 *
 * Stays in sync if `externalValue` changes from outside (e.g. project import).
 */
export function useDebouncedCommit<T>(
  externalValue: T,
  commit: (v: T) => void,
  delayMs = 250,
): [T, (v: T) => void] {
  const [draft, setDraft] = useState(externalValue);
  useEffect(() => { setDraft(externalValue); }, [externalValue]);

  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(() => {
    if (Object.is(draft, externalValue)) return;
    const t = setTimeout(() => commitRef.current(draft), delayMs);
    return () => clearTimeout(t);
  }, [draft, externalValue, delayMs]);

  return [draft, setDraft];
}
