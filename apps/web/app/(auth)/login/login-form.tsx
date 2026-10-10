"use client";

import { useActionState, useState } from "react";
import { Icon } from "../../../components/icon";
import { type LoginState, loginAction } from "./actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<
    LoginState | undefined,
    FormData
  >(loginAction, undefined);
  const [showPassword, setShowPassword] = useState(false);
  return (
    <form action={formAction} className="login-form stack">
      <div className="field">
        <label htmlFor="email">Email address</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          placeholder="you@yourbusiness.com"
        />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <div className="password-field">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            required
            autoComplete="current-password"
            placeholder="Enter your password"
          />
          <button
            type="button"
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            onClick={() => setShowPassword(!showPassword)}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
      </div>
      {state?.error ? (
        <p role="alert" className="notice notice-red">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="button button-primary login-submit"
      >
        {pending ? (
          <>
            <span className="spinner" />
            Signing in…
          </>
        ) : (
          <>
            Sign in to your workspace
            <Icon name="arrow" size={17} />
          </>
        )}
      </button>
    </form>
  );
}
