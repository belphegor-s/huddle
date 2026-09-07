/*
 * Vite hands back the hashed, deployed URL for an asset imported with ?url.
 * Declared here rather than pulling in vite/client, which would make the
 * design package depend on the bundler that happens to consume it.
 */
declare module '*.woff2?url' {
  const src: string;
  export default src;
}
