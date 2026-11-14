import { useEffect, useId, useRef, useState } from "react";

interface Props {
  initials: string;
  onMyProfile: () => void;
  onClinicianDashboard: () => void;
  disabled?: boolean;
}

/** Circular account control with My Profile + Clinician Dashboard. */
export function ProfileMenu({ initials, onMyProfile, onClinicianDashboard, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const buttonId = useId();

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
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="Account menu"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden>{initials}</span>
      </button>
      {open ? (
        <ul id={menuId} className="profile-menu-list" role="menu" aria-labelledby={buttonId}>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onMyProfile();
              }}
            >
              My Profile
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onClinicianDashboard();
              }}
            >
              Clinician Dashboard
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
