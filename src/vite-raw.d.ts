// Vite's `?raw` import suffix yields a file's text; the specs use it to inspect stylesheets.
declare module '*?raw' {
  const content: string;
  export default content;
}
