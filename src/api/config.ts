// Base URL for the Notification Templates API. Never hard-code the host — always
// read it from the environment so dev/staging/prod can point at different backends.
// In dev it is usually relative (/api/v1/templates) and goes through the Vite proxy;
// see vite.config.ts.
const baseUrl = import.meta.env.VITE_API_BASE_URL;

if (!baseUrl) {
  throw new Error(
    "VITE_API_BASE_URL is not set. Copy .env.example to .env.local and set the API base URL.",
  );
}

export const API_BASE_URL: string = baseUrl;
