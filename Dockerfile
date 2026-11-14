FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
COPY docs ./docs
RUN npm ci
EXPOSE 3001
CMD ["npm", "run", "start", "-w", "@neurovision/api"]
