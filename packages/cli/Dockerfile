# No browser is bundled: browse drives a remote Browserbase cloud browser over
# CDP, so the image stays a thin client.
FROM node:20-slim

ARG BROWSE_VERSION
RUN test -n "$BROWSE_VERSION" \
  && npm install -g "browse@${BROWSE_VERSION}" \
  && npm cache clean --force

CMD ["browse", "--help"]
