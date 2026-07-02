FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm install
RUN npx prisma generate
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY prisma ./prisma
RUN npm install --omit=dev
RUN npx prisma generate
COPY --from=build /app/dist ./dist
COPY public ./public
EXPOSE 3000
CMD ["npm", "run", "start:prod"]
