"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button, TextField, Alert } from "@mui/material";
export default function Login() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <main className="login-page">
      <section className="login-story">
        <Link className="brand" href="/">
          <span className="brand-mark">S</span>SignCraft
          <span className="brand-dot">®</span>
        </Link>
        <div>
          <span className="eyebrow">MADE TO BE SEEN. BUILT TOGETHER.</span>
          <h1>
            Great signage.
            <br />
            Seamless operations.
          </h1>
          <p>
            From the first brief to the final installation.
            <br />
            Every job, every team, every step — connected.
          </p>
          <div className="sign-art">
            <div className="sign-art-card">
              GOOD
              <br />
              THINGS
              <br />
              <span>AHEAD ↗</span>
            </div>
            <div className="art-caption">A clearer view of what’s next.</div>
          </div>
        </div>
        <small>SIGNCRAFT OPERATIONS / WORK BETTER, TOGETHER</small>
      </section>
      <section className="login-form">
        <div>
          <span className="eyebrow">YOUR WORKSPACE AWAITS</span>
          <h2>Welcome back.</h2>
          <p className="muted">Sign in to keep things moving.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const data = new FormData(e.currentTarget);
              try {
                const result = await signIn("credentials", {
                  email: data.get("email"),
                  password: data.get("password"),
                  redirect: false,
                });
                if (result?.error)
                  setError(
                    "Unable to sign in. Check your credentials or try again later.",
                  );
                else {
                  router.push("/");
                  router.refresh();
                }
              } catch {
                setError("Unable to connect. Please try again.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <TextField
              label="Email address"
              name="email"
              type="email"
              required
              fullWidth
              autoComplete="username"
            />
            <TextField
              label="Password"
              name="password"
              type="password"
              required
              fullWidth
              autoComplete="current-password"
            />
            {error && <Alert severity="error">{error}</Alert>}
            <Button
              variant="contained"
              type="submit"
              size="large"
              fullWidth
              disabled={busy}
            >
              {busy ? "Signing in…" : "Sign in to workspace →"}
            </Button>
          </form>
          <div className="login-note">
            <strong>One workspace. Three perspectives.</strong>
            <p>
              Managers coordinate. Vendors create.
              <br />
              Installers bring it all to life.
            </p>
          </div>
          <small className="muted">
            Access is provided by your workspace administrator.
          </small>
        </div>
      </section>
    </main>
  );
}
