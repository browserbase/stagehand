# Minimal image that ships the `browse` CLI for use inside code sandboxes
# (E2B, Modal, Daytona, Vercel, ...). No browser is bundled on purpose:
# `browse` connects out to a Browserbase cloud browser over CDP, so the
# image stays small and the sandbox stays a thin client.
#
# Published automatically by .github/workflows/release.yml on every browse
# release, pinned 1:1 to the npm version:
#   docker build --build-arg BROWSE_VERSION=<version> -t browserbase/browse .
ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-slim

# Pin to the exact published version so the image matches the npm release.
ARG BROWSE_VERSION
RUN test -n "$BROWSE_VERSION" \
  && npm install -g "browse@${BROWSE_VERSION}" \
  && npm cache clean --force

WORKDIR /work
CMD ["browse", "--help"]
