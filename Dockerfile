# Toolbox image for InsureTrust: Node 24 + circom 2.2.3 on Linux.
# The project folder is mounted at /app when the container runs (see compose.yaml),
# so nothing is copied into the image.
FROM node:24.18.0-bookworm-slim

# circom compiler, checked against a known SHA-256 so a tampered download fails the build.
ADD --chmod=755 --checksum=sha256:85342c7ff332d948df7c0c50ecf201e6129349aef550ce873f3c811b79fe53a3 \
    https://github.com/iden3/circom/releases/download/v2.2.3/circom-linux-amd64 /usr/local/bin/circom

WORKDIR /app
