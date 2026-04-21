type ProspeoResult = {
  email: string | null;
  verified: boolean;
};

async function callProspeo(linkedinUrl: string, signal?: AbortSignal): Promise<ProspeoResult> {
  const res = await fetch("https://api.prospeo.io/enrich-person", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-KEY": process.env.PROSPEO_API_KEY ?? "",
    },
    body: JSON.stringify({
      only_verified_email: true,
      data: { linkedin_url: linkedinUrl },
    }),
    signal,
  });

  if (res.status === 429) {
    throw new Error("RATE_LIMITED");
  }

  if (!res.ok) {
    return { email: null, verified: false };
  }

  const data = await res.json();
  if (!data.error && data.person?.email?.revealed) {
    return { email: data.person.email.email ?? null, verified: true };
  }
  return { email: null, verified: false };
}

export async function findWorkEmail(params: {
  linkedinUrl: string;
  signal?: AbortSignal;
}): Promise<{ email: string | null }> {
  try {
    return await callProspeo(params.linkedinUrl, params.signal);
  } catch (err) {
    if (params.signal?.aborted) throw err;
    if (err instanceof Error && err.message === "RATE_LIMITED") {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        return await callProspeo(params.linkedinUrl, params.signal);
      } catch (retryErr) {
        if (params.signal?.aborted) throw retryErr;
        return { email: null };
      }
    }
    return { email: null };
  }
}
