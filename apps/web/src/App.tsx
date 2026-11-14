import { CONTRACTS_VERSION } from "@neurovision/domain";
import { GazeLab } from "./GazeLab";
import "./app.css";

export function App() {
  return (
    <main className="app-shell">
      <header className="brand-strip">
        <img
          className="brand-logo"
          src="/assets/neurovision-logo.png"
          alt="NeuroVision"
          width={320}
          height={120}
        />
        <p className="brand-tagline">Spatial Patterns · research prototype</p>
      </header>
      <p className="contracts-meta">Contracts {CONTRACTS_VERSION}</p>
      <GazeLab />
    </main>
  );
}
