FROM alpine:3.20 AS downloader

ARG FRONTEND_VERSION
ARG FRONTEND_REPO=alwayshopeless/sticky-picky

RUN apk add --no-cache curl unzip

WORKDIR /tmp/frontend

RUN test -n "$FRONTEND_VERSION"

RUN curl -fsSL -o frontend.zip \
  "https://github.com/${FRONTEND_REPO}/releases/download/${FRONTEND_VERSION}/sticky-picky-frontend-${FRONTEND_VERSION}-dist.zip" \
  && unzip frontend.zip -d dist

FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=downloader /tmp/frontend/dist/ /usr/share/nginx/html/
