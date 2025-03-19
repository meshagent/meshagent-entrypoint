// global.d.ts
export {};

declare global {
  // For the browser
  interface Window {
    onSendUpdateToBackend?: (msg: string) => void;
    onSendUpdateToClient?: (msg: string) => void;
  }

  // For Node (and possibly TPyV8 if it uses `global`)
  namespace NodeJS {
    interface Global {
      onSendUpdateToBackend?: (msg: string) => void;
      onSendUpdateToClient?: (msg: string) => void;
    }
  }

  // Optionally, you can also declare a plain variable if TPyV8 sets `myGlobalFunction` directly:
  // (useful if TPyV8 doesn’t define `global` or `window`, but just “bare” globals)
  var onSendUpdateToBackend: ((msg: string) => void) | undefined;
  var onSendUpdateToClient: ((msg: string) => void) | undefined;
}
