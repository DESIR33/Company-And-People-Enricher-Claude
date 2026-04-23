export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY);
}

export function getSupabaseConfig():
  | { url: string; publishableKey: string }
  | null {
  if (!isSupabaseConfigured()) return null;
  return {
    url: process.env.SUPABASE_URL as string,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY as string,
  };
}

export async function checkSupabaseHealth(): Promise<boolean> {
  const config = getSupabaseConfig();
  if (!config) return false;
  try {
    const response = await fetch(`${config.url}/auth/v1/health`, {
      headers: {
        apikey: config.publishableKey,
      },
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}
