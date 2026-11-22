import type { CapacitorConfig } from '@capacitor/cli';

// Bundled flavor (default): web assets ship in the app, API calls go to
// VITE_API_BASE_URL from .env.mobile. Remote flavor (internal builds only):
// set CAP_SERVER_URL=https://goldencreations.events to load the live site.
const serverUrl = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'events.goldencreation.app',
  appName: 'Golden Events',
  webDir: 'dist-mobile',
  ...(serverUrl ? { server: { url: serverUrl, cleartext: false } } : {}),
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
