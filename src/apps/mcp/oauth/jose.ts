// Keep the ESM bridge local to MCP and preserve native import in CommonJS builds.
export const loadJose = new Function('return import("jose")') as () => Promise<
  typeof import('jose')
>;
