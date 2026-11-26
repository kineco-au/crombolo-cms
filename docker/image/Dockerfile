# The ready-to-run image (story 087): crombolo from npm at one version, run as a non-root
# user, its state under /data. Started with nothing but settings it makes a site in /data;
# built on top with a site at /site, it runs that one. docs/operations.md, "The container image".
#
# Debian rather than Alpine: extensions run under Deno (story 311), which publishes glibc
# builds only.
FROM oven/bun:1-slim

LABEL org.opencontainers.image.source="https://github.com/kineco-au/crombolo-cms" \
      org.opencontainers.image.description="crombolo, ready to run: a site from settings, its state in /data" \
      org.opencontainers.image.licenses="MIT"

# The release this image runs; `npm` installs it from the registry, `local` from the
# tarballs `scripts/image-context.ts` packed into ./local, as CI builds it before a release.
ARG CROMBOLO_VERSION
ARG CROMBOLO_FROM=npm

# git, for `crombolo bundle deploy`; certificates, for every provider a site calls.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 crombolo \
    && mkdir -p /opt/crombolo /data /site \
    && chown crombolo /data /site

WORKDIR /opt/crombolo
COPY local/ /opt/crombolo/local/
RUN if [ "$CROMBOLO_FROM" = local ]; then cp local/package.json package.json; \
    else printf '{"name":"crombolo-image","private":true,"dependencies":{"@crombolo/crombolo":"%s","@crombolo/cli":"%s"}}\n' \
      "$CROMBOLO_VERSION" "$CROMBOLO_VERSION" > package.json; fi \
    && bun install --production \
    && rm -rf local \
    && ./node_modules/.bin/crombolo --version

ENV PATH=/opt/crombolo/node_modules/.bin:$PATH \
    NODE_ENV=production \
    PORT=8080

COPY entrypoint.sh /usr/local/bin/crombolo-entrypoint
RUN chmod +x /usr/local/bin/crombolo-entrypoint

USER crombolo
WORKDIR /site
VOLUME /data
EXPOSE 8080

# /health answers 503 while the site cannot serve: the database unreachable, an upgrade waiting.
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 \
    CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["crombolo-entrypoint"]
