import { useEffect, useId, useRef, useState } from "react";

interface Props {
  initials: string;
  onSwitchParticipant?: () => void;
  disabled?: boolean;
}

/** Circular account control; Switch participant appears when local identity is on. */
export function ProfileMenu({ initials, onSwitchParticipant, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const buttonId = useId();
  const hasMenu = Boolean(onSwitchParticipant);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="profile-menu" ref={root}>
      <button
        type="button"
        id={buttonId}
        className="profile-avatar"
        aria-haspopup={hasMenu ? "menu" : undefined}
        aria-expanded={hasMenu ? open : undefined}
        aria-controls={hasMenu ? menuId : undefined}
        aria-label={hasMenu ? "Account menu" : "Signed-in participant"}
        disabled={disabled}
        onClick={() => {
          if (hasMenu) setOpen((value) => !value);
        }}
      >
        <span aria-hidden>{initials}</span>
      </button>
      {open && hasMenu ? (
        <ul id={menuId} className="profile-menu-list" role="menu" aria-labelledby={buttonId}>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSwitchParticipant?.();
              }}
            >
              Switch participant
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
