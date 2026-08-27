import { headers } from 'next/headers';

export type AuthUser = { userId: string; email: string; displayName: string };

export async function getAuthUser(): Promise<AuthUser | null> {
  const requestHeaders = await headers();
  const userId = requestHeaders.get('oai-authenticated-user-id');
  const email = requestHeaders.get('oai-authenticated-user-email');
  if (!userId || !email) return null;
  const encoded = requestHeaders.get('oai-authenticated-user-full-name');
  const encoding = requestHeaders.get('oai-authenticated-user-full-name-encoding');
  let displayName = email;
  if (encoded && encoding === 'percent-encoded-utf-8') {
    try { displayName = decodeURIComponent(encoded); } catch { displayName = email; }
  }
  return { userId, email, displayName };
}
