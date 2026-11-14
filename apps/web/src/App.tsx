import { useState } from "react";
import { CONTRACTS_VERSION } from "@neurovision/domain";
import { GazeLab } from "./GazeLab";
import { ProfileDashboard } from "./profile/ProfileDashboard";
import "./app.css";

const logoUrl = new URL("../public/assets/neurovision-logo.png", import.meta.url).href;

type AppView = "profile" | "gaze-lab";

export function App() {
  const [view, setView] = useState<AppView>("profile");

  return (
    <main className="app-shell">
      <header className="app-header">
        <img
          className="brand-logo"
          src={logoUrl}
          alt="NeuroVision"
          width={140}
          height={48}
        />
        <div className="header-copy">
          <h1>Spatial Patterns</h1>
          <p className="brand-tagline">Research prototype</p>
        </div>
        <nav className="app-nav" aria-label="Primary">
          <button
            type="button"
            className={view === "profile" ? "active" : ""}
            onClick={() => setView("profile")}
          >
            Profile
          </button>
          <button
            type="button"
            className={view === "gaze-lab" ? "active" : ""}
            onClick={() => setView("gaze-lab")}
          >
            Gaze lab
          </button>
        </nav>
      </header>
      <p className="contracts-meta">Contracts {CONTRACTS_VERSION}</p>
      {view === "profile" ? <ProfileDashboard /> : <GazeLab />}
    </main>
  );
}
