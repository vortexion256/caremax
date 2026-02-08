/** Optional dependency for image conversion (AVIF etc.). Not required for build. */
declare module 'sharp' {
  function sharp(input: Buffer | Uint8Array): {
    jpeg: (opts: { quality?: number }) => { toBuffer: () => Promise<Buffer> };
  };
  export default sharp;
}
