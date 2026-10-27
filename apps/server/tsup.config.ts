import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  // 워크스페이스 공유 패키지는 TS 소스라서 번들에 포함한다
  noExternal: ['@caps/shared'],
});
