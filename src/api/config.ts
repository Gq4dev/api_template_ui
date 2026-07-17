// Base URL for the Notification Templates API. Never hard-code the host — always
// read it from the environment so dev/staging/prod can point at different backends.
// See api-template/docs/INTEGRATION.md §4.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;
