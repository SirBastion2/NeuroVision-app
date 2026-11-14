import { jsPDF } from "jspdf";
import {
  scoreBatteryRecord,
  scoreSession,
  sessionSourceLabel,
  type AssessmentTrend,
  type BatteryRecord,
  type SessionRecord,
} from "@neurovision/domain";
import type { ClinicalNote } from "./notes-store";

export interface ReportInput {
  profileAlias: string;
  sessions: SessionRecord[];
  selected: SessionRecord | null;
  trend: AssessmentTrend;
  notes: ClinicalNote[];
  generatedAt?: string;
  battery?: BatteryRecord | null;
}

/** Build a real downloadable clinician-facing PDF from scored session data. */
export function buildClinicianReportPdf(input: ReportInput): Blob {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  let y = 54;

  const line = (text: string, size = 11, color: [number, number, number] = [28, 32, 36]) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const wrapped = doc.splitTextToSize(text, 500);
    doc.text(wrapped, 56, y);
    y += wrapped.length * (size + 4) + 4;
    if (y > 720) {
      doc.addPage();
      y = 54;
    }
  };

  doc.setFillColor(244, 241, 234);
  doc.rect(0, 0, 612, 48, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(34, 56, 42);
  doc.text("NeuroVision · Clinician session report", 56, 32);
  y = 72;

  line(`Profile: ${input.profileAlias}`, 12);
  line(`Generated: ${generatedAt}`, 10, [90, 96, 102]);
  line(
    "Research observations only. This report does not provide diagnoses, treatment recommendations, or claims about daily function.",
    10,
    [90, 96, 102],
  );
  line(
    "Data integrity: session records are validated with @neurovision/domain parseSessionRecord. Demonstration and live sources are labeled separately. Notes in this build are stored only in this browser.",
    10,
    [90, 96, 102],
  );
  y += 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(34, 56, 42);
  doc.text("Selected session", 56, y);
  y += 18;

  if (!input.selected) {
    line("No session selected.");
  } else {
    const scored = scoreSession(input.selected);
    line(`${input.selected.alias} · ${input.selected.id}`);
    line(
      `Source: ${sessionSourceLabel(input.selected.source)} · Status: ${input.selected.status} · Completed: ${input.selected.completedAt || "—"}`,
    );
    line(
      `Spatial pattern: ${scored.spatialPattern.kind} — ${scored.spatialPattern.description}`,
    );
    if (scored.targetSelection) {
      const t = scored.targetSelection;
      line(
        `Target selection: ${t.hits}/${t.available} hits (${Math.round(t.hitRate * 100)}%), omissions L ${t.left.omissions} / R ${t.right.omissions}, asymmetry ${t.omissionAsymmetry ?? "—"}.`,
      );
    }
    line(
      `Line bisection signed median: ${scored.lineBisection.signedMedian ?? "—"} · Practice suggestion: cue ${scored.practice.cue}, density ${scored.practice.density}.`,
    );
    if (scored.practice.override) {
      line(`Practice override note: ${scored.practice.override}`);
    }
  }

  if (input.battery) {
    y += 10;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(34, 56, 42);
    doc.text("Battery", 56, y);
    y += 18;

    const battery = input.battery;
    const scored = scoreBatteryRecord(battery);
    const counted = scored.evidence.tests.filter((row) => row.included);
    const lean = scored.evidence.lean;
    line(`${battery.id} · ${battery.mode} · ${sessionSourceLabel(battery.source)}`);
    line(`Verdict: ${scored.evidence.verdict.text}`);
    line(
      `Lean estimate ${lean.mean.toFixed(2)}, 90% range ${lean.lo.toFixed(2)} to ${lean.hi.toFixed(2)}, in units of normal person-to-person variation; negative means the left side is weaker.`,
    );
    line(
      `Hypotheses: left weaker ${Math.round(scored.evidence.posterior.left * 100)}%, balanced ${Math.round(scored.evidence.posterior.none * 100)}%, right weaker ${Math.round(scored.evidence.posterior.right * 100)}%.`,
    );
    const indexByTest: Partial<Record<(typeof counted)[number]["test"], number>> = {
      scene: scored.scene.observationVisible.value,
      clock: scored.clock.observation.value,
      greyscales: scored.greyscales?.observation.value,
      bisection: scored.bisection?.observation.value,
    };
    for (const row of counted) {
      const flag = row.discordant ? ", disagrees" : "";
      const index = indexByTest[row.test];
      const indexText = index == null ? "n/a" : index.toFixed(2);
      line(
        `${row.label}: lateral index ${indexText}, contribution ${row.favors} ${row.factor.toFixed(1)}x${flag}.`,
        10,
      );
    }
    line("Screening aid, not a diagnosis.", 10, [90, 96, 102]);
    if (scored.evidence.usesUncalibratedNorms) {
      line("Some tests have no published healthy range and were not scored against norms.", 10, [90, 96, 102]);
    }
    if (scored.evidence.usesAssumedNorms) {
      line("Some healthy norms are still marked assumed and are not from published data.", 10, [90, 96, 102]);
    }
    if (battery.source === "demonstration") {
      line("Demonstration record.", 10, [90, 96, 102]);
    }
  }

  y += 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(34, 56, 42);
  doc.text("Comparable live trend", 56, y);
  y += 18;

  if (input.trend.points.length === 0) {
    line("No comparable live assessment points in history yet.");
  } else {
    for (const point of input.trend.points) {
      line(
        `${point.completedAt.slice(0, 10)} · ${point.alias}: hitRate ${Math.round(point.hitRate * 100)}%, omissions L/R ${point.omissionsLeft}/${point.omissionsRight}, pattern ${point.patternKind}`,
        10,
      );
    }
  }

  y += 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(34, 56, 42);
  doc.text("Clinical notes (local browser only)", 56, y);
  y += 18;

  if (input.notes.length === 0) {
    line("No notes saved for this browser profile.");
  } else {
    for (const note of input.notes.slice(0, 12)) {
      line(`${note.updatedAt.slice(0, 19)} · session ${note.sessionId ?? "general"}`, 10);
      line(note.body, 10);
      y += 4;
    }
  }

  y += 12;
  line(`Sessions included in history export count: ${input.sessions.length}.`, 10, [90, 96, 102]);
  line("End of report.", 10, [90, 96, 102]);

  return doc.output("blob");
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
