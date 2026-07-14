import { useRef } from 'react';
import { useDialogStore } from '../state/dialogStore';

/**
 * UX-5: renders the single active DialogRequest (if any) as a bottom sheet, reusing
 * RoomEditSheet's backdrop/sheet classes. Mounted once in App.tsx so every screen's
 * confirm/prompt/pick/alert call routes through the same in-app UI instead of
 * window.confirm/prompt/alert. The prompt input is uncontrolled (defaultValue + ref)
 * rather than synced via state — `active` goes through `null` between requests (only
 * one dialog is ever shown at a time), which unmounts and remounts the input fresh, so
 * there's nothing to reset on a new request.
 */
export function DialogHost() {
  const active = useDialogStore((s) => s.active);
  const settle = useDialogStore((s) => s.settle);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!active) return null;

  function dismiss() {
    settle(active!.kind === 'confirm' ? false : null);
  }

  return (
    <div className="room-edit-backdrop" onClick={dismiss}>
      <div className="room-edit-sheet" onClick={(e) => e.stopPropagation()}>
        <h2>{active.title}</h2>
        {active.body && <p>{active.body}</p>}

        {active.kind === 'prompt' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              settle(inputRef.current?.value ?? '');
            }}
          >
            <label className="room-edit-field">
              <input
                ref={inputRef}
                type="text"
                autoFocus
                placeholder={active.placeholder}
                defaultValue={active.initialValue ?? ''}
              />
            </label>
          </form>
        )}

        {active.kind === 'pick' && (
          <div className="dialog-options">
            {(active.options ?? []).map((option) => (
              <button
                key={option}
                type="button"
                className="tap-target"
                onClick={() => settle(option)}
              >
                {option}
              </button>
            ))}
          </div>
        )}

        <div className="room-edit-actions">
          {active.kind === 'alert' && (
            <button type="button" className="tap-target btn-primary" onClick={() => settle(true)}>
              {active.confirmLabel ?? 'OK'}
            </button>
          )}
          {active.kind === 'pick' && (
            <button type="button" className="tap-target" onClick={dismiss}>
              Cancel
            </button>
          )}
          {(active.kind === 'confirm' || active.kind === 'prompt') && (
            <>
              <button type="button" className="tap-target" onClick={dismiss}>
                Cancel
              </button>
              <button
                type="button"
                className={`tap-target ${active.danger ? 'btn-danger' : 'btn-primary'}`}
                onClick={() =>
                  settle(active!.kind === 'confirm' ? true : (inputRef.current?.value ?? ''))
                }
              >
                {active.confirmLabel ?? 'OK'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
