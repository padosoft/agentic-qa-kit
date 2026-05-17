export default function Login() {
  return (
    <main style={{ padding: 32 }}>
      <h1>Login</h1>
      <form method="POST" action="/api/auth/login">
        <input name="email" type="email" required />
        <input name="password" type="password" required minLength={12} />
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
