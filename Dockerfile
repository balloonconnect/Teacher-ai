# Kavli: API + built front end in one image, with Tamil + English OCR for scanned textbooks.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# The repository's .env.production turns on the browser-only UI-preview mode (used for the Vercel review site). A real deployment must not.
ENV VITE_UI_PREVIEW=0
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng tesseract-ocr-tam poppler-utils ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
# Tamil OCR: the most accurate Tesseract model (tessdata_best) reads the Class 8 book far better than the packaged one. If the download fails the packaged data is kept.
RUN T="$(dirname "$(find /usr/share -name tam.traineddata | head -1)")" \
 && curl -fsSL --retry 3 -o /tmp/tam.best https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/main/tam.traineddata \
 && [ "$(stat -c%s /tmp/tam.best)" -gt 5000000 ] && mv /tmp/tam.best "$T/tam.traineddata" \
 || echo "Keeping the packaged Tamil OCR data"; rm -f /tmp/tam.best
WORKDIR /app
ENV NODE_ENV=production PORT=3001 SEED_DEMO=0
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY scripts ./scripts
COPY tsconfig.json tsconfig.server.json ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "server/index.ts"]
