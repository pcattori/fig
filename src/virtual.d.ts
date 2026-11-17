declare module "fig:plugins" {
  export const plugins: typeof import("./api.ts").plugins;
  export type Plugin = import("./api.ts").Plugin;
  export type Transform<T> = import("./api.ts").Transform<T>;
}
