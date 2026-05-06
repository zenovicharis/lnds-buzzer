const currentHostname = globalThis.location?.hostname || "localhost";
const isSecurePage = globalThis.location?.protocol === "https:";

const DEFAULT_CONFIG = {
  supabaseUrl: `${isSecurePage ? "https" : "http"}://${currentHostname}:54321`,
  realtimeUrl: `${isSecurePage ? "wss" : "ws"}://${currentHostname}:54324/socket/websocket`,
  supabaseAnonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlLWxvY2FsIiwiaWF0IjoxNzc3OTcxNTA5LCJleHAiOjE4MDk1MDc1MDl9.qG8ROv2NimgF60YQzWEEiO8IlvZ_RNrzg81JGCbIesM",
};

const runtimeConfig = globalThis.BUZZER_CONFIG || {};

export const APP_CONFIG = {
  ...DEFAULT_CONFIG,
  ...runtimeConfig,
};

export function getRealtimeUrl() {
  const url = new URL(APP_CONFIG.realtimeUrl);
  url.searchParams.set("apikey", APP_CONFIG.supabaseAnonKey);
  url.searchParams.set("vsn", "1.0.0");
  return url.toString();
}
