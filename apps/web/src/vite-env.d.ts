/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_STANDALONE?: string;
  readonly VITE_IDENTITY_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
