// Thin launcher: reads env, creates the app, listens.

import { createApp } from "./app";

const PORT = Number(process.env.PORT ?? 4001);
const API_KEY = process.env.VENDOR_API_KEY;

if (!API_KEY) {
    console.error("VENDOR_API_KEY must be set (see .env.example)");
    process.exit(1);
}

createApp({ apiKey: API_KEY }).listen(PORT, () => {
    console.log(`[vendor-api] mock Commission Quote API listening on :${PORT}`);
});