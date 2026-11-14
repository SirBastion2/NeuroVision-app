import { CONTRACTS_VERSION } from "@neurovision/domain";
import { GazeLab } from "./GazeLab";
import "./app.css";

const logoUrl = new URL("../public/assets/neurovision-logo.png", import.meta.url).href;

export function App() {
  return (
    <main className="app-shell">
      <header className="brand-strip">
        <img
          className="brand-logo"
          src={logoUrl}
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
