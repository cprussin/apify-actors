# Build context is this actor directory (apify push uploads only this folder).
# Playwright image: headless Chromium passes Trustpilot's bot check once per run.
# Keep the tag in sync with the "playwright" version in package.json.
FROM apify/actor-node-playwright-chrome:22-1.56.1 AS builder
COPY --chown=myuser:myuser package*.json ./
RUN npm install --include=dev --audit=false --fund=false
COPY --chown=myuser:myuser . ./
RUN npm run build

FROM apify/actor-node-playwright-chrome:22-1.56.1
COPY --chown=myuser:myuser package*.json ./
RUN npm install --omit=dev --omit=optional --audit=false --fund=false \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" && node --version \
    && echo "NPM version:" && npm --version \
    && rm -r ~/.npm
COPY --from=builder --chown=myuser:myuser /home/myuser/dist ./dist
COPY --chown=myuser:myuser . ./
CMD ["npm", "run", "start", "--silent"]
