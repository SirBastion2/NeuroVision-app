import { CONTRACTS_VERSION } from "@neurovision/domain";
import { GazeLab } from "./GazeLab";
import "./app.css";

const logoUrl = new URL("../public/assets/neurovision-logo.png", import.meta.url).href;

export function App() {
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
      </header>
      <p className="contracts-meta">Contracts {CONTRACTS_VERSION}</p>
      <GazeLab />
    </main>
  );
}
