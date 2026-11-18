FROM node:18-alpine

WORKDIR /usr/src/app

# 先拷贝依赖声明，利用 Docker 层缓存
COPY package.json ./
RUN npm install --production --no-audit --no-fund

# 再拷贝源码
COPY . .

EXPOSE 80

CMD ["node", "index.js"]
