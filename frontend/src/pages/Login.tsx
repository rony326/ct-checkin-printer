import { useState } from 'react';

interface Props {
  mode: 'setup' | 'login';
  onSuccess: () => void;
}

export function Login({ mode, onSuccess }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const isSetup = mode === 'setup';

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/auth/${isSetup ? 'setup' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setError(body.error ?? 'Anmeldung fehlgeschlagen');
        return;
      }
      onSuccess();
    } catch {
      setError('Server nicht erreichbar');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login">
      <form className="panel login-card" onSubmit={handleSubmit}>
        <h1>ct-checkin-printer</h1>
        <p className="hint" style={{ marginTop: 0, marginBottom: '1.5rem' }}>
          {isSetup ? 'Willkommen! Leg zuerst ein Admin-Passwort fest.' : 'Bitte melde dich an.'}
        </p>
        <div className="field">
          <label htmlFor="login-password">{isSetup ? 'Neues Admin-Passwort' : 'Passwort'}</label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSetup ? 'new-password' : 'current-password'}
            minLength={8}
            required
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'login-error' : isSetup ? 'login-rule' : undefined}
          />
          {isSetup && (
            <span id="login-rule" className="hint">
              Mindestens 8 Zeichen.
            </span>
          )}
        </div>
        {error && (
          <p id="login-error" className="error-text" role="alert" style={{ marginTop: 0 }}>
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? (isSetup ? 'Richtet ein…' : 'Meldet an…') : isSetup ? 'Einrichten' : 'Anmelden'}
        </button>
      </form>
    </main>
  );
}
