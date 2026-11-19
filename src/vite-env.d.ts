/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_DEMO_MODE: string;
  readonly VITE_APP_NAME: string;
  readonly VITE_APP_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'virtual:sample-rulebooks' {
  interface SampleRulebook {
    name: string;
    url: string;
  }

  const sampleRulebooks: SampleRulebook[];
  export default sampleRulebooks;
}
