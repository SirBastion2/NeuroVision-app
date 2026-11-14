import type { Point } from "./board.js";

export interface GazeSample {
  elapsed: number;
  x: number;
  y: number;
}

export interface TrackingGap {
  start: number;
  end: number;
}

export interface GazeStream {
  id: string;
  label: string;
  samples: GazeSample[];
  gaps: TrackingGap[];
}

export interface CalibrationPoint extends Point {}

export interface CalibrationQualityReport {
  pointCount: number;
  leftRightAgreement: number;
  gridAgreement: number;
  averageErrorPx: number;
}
