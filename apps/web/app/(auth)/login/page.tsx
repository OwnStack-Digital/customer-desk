import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — BOS" };

export default function LoginPage() {
  return (
    <main
      style={{
        maxWidth: "380px",
        margin: "0 auto",
        padding: "1.5rem 1rem",
      }}
    >
      <h1 style={{ fontSize: "1.25rem" }}>Sign in to BOS</h1>
      <p style={{ color: "#555", marginTop: 0 }}>
        Owner access for Harbour &amp; Pine Cleaning.
      </p>
      <LoginForm />
    </main>
  );
}
