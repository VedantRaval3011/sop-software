const REQUIRED = ["MONGODB_URI"] as const;

const OPTIONAL_GROUPS = {
  auth: ["NEXTAUTH_SECRET", "NEXTAUTH_URL"],
  gemini: ["GEMINI_API_KEY"],
  bunny: ["BUNNY_STORAGE_PASSWORD", "BUNNY_STORAGE_ZONE", "BUNNY_STORAGE_HOSTNAME", "BUNNY_PULL_ZONE_URL"],
} as const;

let validated = false;

export function validateEnv(options?: { requireAuth?: boolean; requireBunny?: boolean }) {
  if (validated) return;

  const missing: string[] = [];
  for (const key of REQUIRED) {
    if (!process.env[key]) missing.push(key);
  }

  if (options?.requireAuth) {
    for (const key of OPTIONAL_GROUPS.auth) {
      if (!process.env[key]) missing.push(key);
    }
  }

  if (options?.requireBunny) {
    for (const key of OPTIONAL_GROUPS.bunny) {
      if (!process.env[key]) missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  validated = true;
}

export function getBunnyConfig() {
  const apiKey = process.env.BUNNY_STORAGE_PASSWORD;
  const storageZone = process.env.BUNNY_STORAGE_ZONE;
  const hostname = process.env.BUNNY_STORAGE_HOSTNAME;
  const cdnUrl = process.env.BUNNY_PULL_ZONE_URL?.replace(/\/$/, "");

  if (!apiKey || !storageZone || !hostname || !cdnUrl) {
    throw new Error(
      "Bunny CDN not configured. Set BUNNY_STORAGE_PASSWORD, BUNNY_STORAGE_ZONE, BUNNY_STORAGE_HOSTNAME, and BUNNY_PULL_ZONE_URL in .env.local",
    );
  }

  return { apiKey, storageZone, hostname, cdnUrl };
}

export function isBunnyConfigured(): boolean {
  return Boolean(
    process.env.BUNNY_STORAGE_PASSWORD &&
      process.env.BUNNY_STORAGE_ZONE &&
      process.env.BUNNY_STORAGE_HOSTNAME &&
      process.env.BUNNY_PULL_ZONE_URL,
  );
}
