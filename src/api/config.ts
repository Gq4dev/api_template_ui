// Base URL for the Notification Templates API. Never hard-code the host — always
// read it from the environment so dev/staging/prod can point at different backends.
// See api-template/docs/INTEGRATION.md §4.
const baseUrl = import.meta.env.VITE_API_BASE_URL;

if (!baseUrl) {
  throw new Error(
    "VITE_API_BASE_URL is not set. Copy .env.example to .env.development and set the API base URL.",
  );
}

export const API_BASE_URL: string = baseUrl;
