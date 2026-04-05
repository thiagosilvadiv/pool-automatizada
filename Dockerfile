FROM node:20-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y build-essential python3 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm install --include=dev
RUN npm rebuild

FROM node:20-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public

# Mount your config.json to /app/config.json
EXPOSE 3000
CMD ["node", "dist/index.js", "--ui"]
