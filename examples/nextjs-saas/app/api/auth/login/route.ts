import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const form = await req.formData();
  const email = String(form.get('email') ?? '');
  const password = String(form.get('password') ?? '');
  if (!email.includes('@') || password.length < 12) {
    return NextResponse.json({ error: 'invalid credentials' }, { status: 400 });
  }
  // Session cookie is intentionally HttpOnly + SameSite=Lax (invariant under
  // QA: aqa's web-ui pack asserts this combination on /api/auth/login).
  const res = NextResponse.json({ ok: true });
  res.cookies.set('session', 'demo-token', {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
  });
  return res;
}
