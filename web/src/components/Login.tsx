import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { User } from '../types';
import { Avatar } from './Avatar';
import { Logo } from './Logo';

export function Login() {
  const { actions } = useStore();
  const [demo, setDemo] = useState<User[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.demoUsers().then((r) => setDemo(r.users)).catch(() => setError('Cannot reach the server. Is it running?'));
  }, []);

  const enter = async (n: string) => {
    setBusy(true);
    setError(null);
    try {
      await actions.login(n);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in');
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) void enter(name);
  };

  return (
    <main className="login">
      <div className="login-card">
        <div className="login-brand">
          <Logo size={56} />
          <h1>Huddle</h1>
          <p>Quick conversations, tidy threads, one place for the team.</p>
        </div>

        {demo.length > 0 && (
          <section aria-label="Demo users">
            <h2 className="login-h">Jump in as a demo teammate</h2>
            <div className="demo-grid">
              {demo.map((u) => (
                <button key={u.id} className="demo-user" disabled={busy} onClick={() => void enter(u.name)}>
                  <Avatar user={u} size={40} />
                  <span>{u.name}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <form onSubmit={submit} className="login-form">
          <h2 className="login-h">{demo.length ? 'Or pick your own name' : 'What should we call you?'}</h2>
          <div className="row">
            <input
              aria-label="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder="e.g. Sam Rivera"
              autoFocus
            />
            <button className="btn primary" type="submit" disabled={busy || !name.trim()}>
              Continue
            </button>
          </div>
          <p className="hint">No password: this prototype just remembers your name in this browser.</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
