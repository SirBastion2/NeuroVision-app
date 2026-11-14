import { CONTRACTS_VERSION } from "@neurovision/domain";
import { GazeLab } from "./GazeLab";

export function App() {
  return (
    <main>
      <h1>Spatial Patterns</h1>
      <p>NeuroVision</p>
      <p>Contracts {CONTRACTS_VERSION}</p>
      <GazeLab />
    </main>
  );
}
