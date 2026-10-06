"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useState } from "react";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const response = await fetch("/api/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      setError("Registration failed. That email may already be registered.");
      setPending(false);
      return;
    }

    // Registration succeeded: sign in immediately.
    const result = await signIn("credentials", { email, password, redirect: false });
    if (result?.error) {
      window.location.href = "/login";
      return;
    }
    window.location.href = "/dashboard";
  }

  return (
    <form onSubmit={onSubmit} data-testid="register-form" style={{ maxWidth: 360, display: "grid", gap: "0.75rem" }}>
      <h1>Create your account</h1>
      <label>
        Email
        <input
          data-testid="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          required
        />
      </label>
      <label>
        Password
        <input
          data-testid="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          required
          minLength={10}
        />
      </label>
      {error ? (
        <p style={{ color: "crimson" }} data-testid="error">
          {error}
        </p>
      ) : null}
      <button type="submit" data-testid="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </button>
      <p>
        Already registered? <Link href="/login">Sign in</Link>
      </p>
    </form>
  );
}