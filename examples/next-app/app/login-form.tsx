"use client";

import { useActionState, useEffect } from "react";
import { type LoginState, loginAction } from "./actions";

const initialState: LoginState = {
  ok: false,
  message: "",
};

type LoginFormProps = {
  onLogin: (username: string) => void;
};

export default function LoginForm({ onLogin }: LoginFormProps) {
  const [state, formAction, pending] = useActionState(
    loginAction,
    initialState,
  );

  useEffect(() => {
    if (state.ok && state.user) {
      onLogin(state.user);
    }
  }, [state.ok, state.user, onLogin]);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>OPERATOR LOGIN</h2>
        <span className="status-indicator offline">OFFLINE</span>
      </div>
      <p className="hint">
        Use any email and password <span className="code">demo</span>
      </p>
      <form action={formAction} className="login-form">
        <label className="field">
          <span className="field-label">EMAIL</span>
          <input
            name="email"
            type="email"
            placeholder="operator@system.local"
            required
            className="field-input"
          />
        </label>
        <label className="field">
          <span className="field-label">PASSWORD</span>
          <input
            name="password"
            type="password"
            placeholder="demo"
            required
            className="field-input"
          />
        </label>
        <button type="submit" disabled={pending} className="btn-primary full">
          {pending ? "AUTHENTICATING..." : "LOGIN"}
        </button>
        {state.message && !state.ok && (
          <p className="form-error">{state.message}</p>
        )}
      </form>
    </section>
  );
}
