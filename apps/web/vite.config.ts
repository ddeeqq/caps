import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 폰에서 모션 센서·카메라를 쓰려면 HTTPS가 필요하다: `pnpm dev:https`
const https = process.env.HTTPS === '1';
const api = process.env.API_URL ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react(), ...(https ? [basicSsl()] : [])],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: api, changeOrigin: true },
      '/socket.io': { target: api, ws: true, changeOrigin: true },
    },
  },
  build: {
    // 오래된 폰도 받아 주도록 문법을 낮춘다: 아이폰 iOS 15(사파리 15), 갤럭시의 삼성 인터넷·크롬 90대
    target: ['es2020', 'safari15', 'chrome90', 'firefox90'],
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 600,
    // 한글 폰트 조각(woff2)은 CSS에 base64로 넣지 않는다. 넣으면 CSS가 수백 KB로 불어나고,
    // unicode-range 덕분에 실제로 쓰는 조각만 따로 내려받는 이점이 사라진다.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
  },
});
