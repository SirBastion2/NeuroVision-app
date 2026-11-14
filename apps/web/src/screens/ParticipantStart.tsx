import { useState, type FormEvent } from "react";
import { Eyebrow } from "../components/Brand";
import { participantIdMessage } from "../services/participant-id";

interface Props {
  initialId?: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (participantId: string) => void;
}

export function ParticipantStart({ initialId = "", busy = false, error = null, onSubmit }: Props) {
  const [value, setValue] = useState(initialId);
  const [localError, setLocalError] = useState<string | null>(null);
  const message = localError ?? error;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const invalid = participantIdMessage(value);
    if (invalid) {
      setLocalError(invalid);
      return;
    }
    setLocalError(null);
    onSubmit(value.trim());
  };

  return (
    <section className="intro card narrow start-card">
      <Eyebrow>Shared session</Eyebrow>
      <h1>Enter a participant ID</h1>
      <p className="lede">
        Use the same ID on another device to open that participant's history from the shared database.
      </p>
      <form onSubmit={submit}>
        <label className="field">
          <span>Participant ID</span>
          <input
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (localError) setLocalError(null);
            }}
            placeholder="e.g. P-014"
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={32}
            autoFocus
            disabled={busy}
          />
          <small>Letters, digits, and dashes. 3–32 characters.</small>
        </label>
        {message ? (
          <p className="notice error" role="alert">
            {message}
          </p>
        ) : null}
        <button className="primary large" type="submit" disabled={busy}>
          Continue
          <span aria-hidden> →</span>
        </button>
        <p className="fineprint">Organization stays org-demo. This ID is the sign-in subject.</p>
      </form>
    </section>
  );
}
