# 말문 — 한 컨테이너에서 실시간 서버 + 웹 앱을 함께 제공한다.
#
#   docker build -t malmun .
#   docker run -p 3001:3001 -v malmun-data:/data malmun
#
# 폰의 모션 센서·카메라는 HTTPS에서만 열리므로, 실제 행사에서는 HTTPS를 붙여 주는
# 호스팅(Render, Fly.io, Railway 등)이나 리버스 프록시 뒤에 둔다.

# ── 1단계: 설치·빌드 ───────────────────────────
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo

# 의존성 목록만 먼저 복사해 설치 레이어를 캐시한다
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY tools/package.json tools/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build \
 && pnpm --filter @caps/server deploy --prod --legacy /out/server \
 && cp -r apps/web/dist /out/web

# ── 2단계: 실행 이미지 (빌드 도구 없이 서버 번들 + 운영 의존성 + 웹 정적 파일) ──
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3001 \
    DATA_DIR=/data \
    WEB_DIST=/app/web \
    LOG_LEVEL=info
WORKDIR /app
COPY --from=build /out/server ./server
COPY --from=build /out/web ./web
RUN mkdir -p /data && chown node:node /data
USER node
# VOLUME 지시어는 쓰지 않는다: Railway는 이를 거부하고, 저장 공간은 호스팅의 볼륨을 /data에 붙인다
# (docker run -v malmun-data:/data 처럼)
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1
CMD ["node", "server/dist/index.js"]
