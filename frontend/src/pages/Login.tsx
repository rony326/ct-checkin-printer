import { useState } from 'react';

interface Props {
  mode: 'setup' | 'login';
  onSuccess: () => void;
}

export function Login({ mode, onSuccess }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/auth/${mode === 'setup' ? 'setup' : 'login'}`, {
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
    <main style={{ maxWidth: 360, margin: '4rem auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1>ct-checkin-printer</h1>
      <p>{mode === 'setup' ? 'Admin-Passwort festlegen' : 'Anmelden'}</p>
      <form onSubmit={handleSubmit}>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Passwort"
          minLength={8}
          required
          autoFocus
          style={{ width: '100%', padding: 8, marginBottom: 8 }}
        />
        <button type="submit" disabled={submitting} style={{ width: '100%', padding: 8 }}>
          {mode === 'setup' ? 'Einrichten' : 'Anmelden'}
        </button>
      </form>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
    </main>
  );
}
