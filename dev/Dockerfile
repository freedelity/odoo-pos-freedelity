# Odoo + Google Chrome so POS tours (HttpCase) can run headless.
ARG ODOO_VERSION=18.0
FROM docker.io/library/odoo:${ODOO_VERSION}
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends wget ca-certificates python3-websocket \
 && wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
 && apt-get install -y --no-install-recommends /tmp/chrome.deb \
 && rm -rf /tmp/chrome.deb /var/lib/apt/lists/*
USER odoo
