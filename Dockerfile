FROM node:18-alpine

WORKDIR /usr/src/app

# Cache dependency layer
COPY package.json ./
RUN npm install --production --no-audit --no-fund

# Copy source
COPY . .

EXPOSE 80

CMD ["node", "index.js"]
