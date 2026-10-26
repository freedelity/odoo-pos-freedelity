#!/usr/bin/env bash
# Start a demo Odoo (with demo data) + the fake CustomerScreen terminal, for manual testing.
#   dev/run-demo.sh 18.0   -> Odoo on http://localhost:18069 (admin/admin), terminal on 127.0.0.1:19005
#   dev/run-demo.sh 19.0   -> Odoo on http://localhost:28069,                 terminal on 127.0.0.1:29005
#   dev/run-demo.sh 18.0 stop
set -euo pipefail
VERSION=${1:?Odoo version, e.g. 18.0}
MAJOR=${VERSION%%.*}
OFFSET=$((MAJOR - 17))
ODOO_PORT=${OFFSET}8069
TERMINAL_PORT=${OFFSET}9005
ADDONS=$(cd "$(dirname "$0")/.." && pwd)
POD=pos-freedelity-demo-$MAJOR
DB=demo

if [ "${2:-}" = stop ]; then
    podman pod rm -f "$POD" >/dev/null && echo "stopped $POD"
    exit 0
fi
podman pod exists "$POD" && podman pod rm -f "$POD" >/dev/null
podman pod create --name "$POD" -p "$ODOO_PORT:8069" -p "$TERMINAL_PORT:9005" >/dev/null
podman run -d --pod "$POD" --name "$POD-db" -e POSTGRES_USER=odoo -e POSTGRES_PASSWORD=odoo \
    -e POSTGRES_DB=postgres docker.io/library/postgres:16-alpine >/dev/null
sleep 5
IMAGE="localhost/pos-freedelity-dev:$VERSION"
RUN=(podman run --rm -i --init --pod "$POD" -e HOST=127.0.0.1 -e USER=odoo -e PASSWORD=odoo
     -v "$ADDONS:/mnt/extra-addons:ro,Z" "$IMAGE")
OPTS=(-d "$DB" --addons-path=/usr/lib/python3/dist-packages/odoo/addons,/mnt/extra-addons)
DEMO=(); [ "$MAJOR" -ge 19 ] && DEMO=(--with-demo)
"${RUN[@]}" odoo "${OPTS[@]}" -i point_of_sale,pos_freedelity "${DEMO[@]}" --stop-after-init >/dev/null 2>&1
# The browser reaches the fake terminal through the published port.
"${RUN[@]}" odoo shell "${OPTS[@]}" --no-http >/dev/null 2>&1 <<PY
config = env['pos.config'].search([], order='id', limit=1)
config.write({'freedelity_enabled': True, 'freedelity_terminal_host': '127.0.0.1',
              'freedelity_terminal_port': $TERMINAL_PORT})
env.cr.commit()
PY
podman run -d --init --pod "$POD" --name "$POD-terminal" -v "$ADDONS:/mnt/extra-addons:ro,Z" "$IMAGE" \
    python3 /mnt/extra-addons/pos_freedelity/tests/ecr_mock.py --port 9005 >/dev/null
podman run -d --init --pod "$POD" --name "$POD-odoo" -e HOST=127.0.0.1 -e USER=odoo -e PASSWORD=odoo \
    -v "$ADDONS:/mnt/extra-addons:ro,Z" "$IMAGE" odoo -d "$DB" --db-filter="^$DB\$" \
    --addons-path=/usr/lib/python3/dist-packages/odoo/addons,/mnt/extra-addons --dev=xml >/dev/null
echo "Odoo $VERSION: http://localhost:$ODOO_PORT (admin/admin) - fake terminal: 127.0.0.1:$TERMINAL_PORT"
