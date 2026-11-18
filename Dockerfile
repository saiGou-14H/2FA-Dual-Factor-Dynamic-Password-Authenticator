# 云托管「从代码仓库部署」入口：构建 server/ 目录的后端代码
FROM node:18-alpine

WORKDIR /usr/src/app

# 先拷贝依赖声明，利用 Docker 层缓存
COPY server/package.json ./
RUN npm install --production --no-audit --no-fund

# 拷贝后端源码
COPY server/ .

EXPOSE 80

CMD ["node", "index.js"]
