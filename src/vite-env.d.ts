/// <reference types="vite/client" />

declare const __BUILD_TIMESTAMP__: string;

declare module '*?worker' {
  const workerConstructor: new () => Worker;
  export default workerConstructor;
}
