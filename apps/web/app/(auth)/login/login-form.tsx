"use client";

import { useActionState } from "react";
import { type LoginState, loginAction } from "./actions";

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "0.5rem",
  fontSize: "1rem",
  marginBottom: "0.75rem",
  border: "1px solid #ccc",
  borderRadius: 4,
};

export function LoginForm() {
  const [state, formAction, pending] = useActionState<
    LoginState | undefined,
    FormData
  >(loginAction, undefined);
  return (
    <form action={formAction}>
      <label htmlFor="email">Email</label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="username"
        style={inputStyle}
      />
      <label htmlFor="password">Password</label>
      <input
        id="password"
        name="password"
        type="password"
        required
        autoComplete="current-password"
        style={inputStyle}
      />
      <button
        type="submit"
        disabled={pending}
        style={{
          width: "100%",
          padding: "0.5rem",
          fontSize: "1rem",
          border: "none",
          borderRadius: 4,
          background: "#1663c7",
          color: "#fff",
          cursor: pending ? "wait" : "pointer",
        }}
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
      {state?.error ? (
        <p role="alert" style={{ color: "#b00020", marginTop: "0.75rem" }}>
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
