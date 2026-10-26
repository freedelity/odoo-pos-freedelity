#!/usr/bin/env bash
# Install pos_freedelity on a throw-away database and run its tests.
#   dev/run-tests.sh 18.0            # all pos_freedelity tests
#   dev/run-tests.sh 19.0 /pos_freedelity:TestFreedelityUi.test_auto_start
set -euo pipefail
VERSION=${1:?Odoo version, e.g. 18.0}
TAGS=${2:-/pos_freedelity}
ADDONS=$(cd "$(dirname "$0")/.." && pwd)
POD=pos-freedelity-${VERSION%%.*}
DB=test_pos_freedelity

if ! podman pod exists "$POD"; then
    podman pod create --name "$POD" >/dev/null
    podman run -d --pod "$POD" --name "$POD-db" -e POSTGRES_USER=odoo -e POSTGRES_PASSWORD=odoo \
        -e POSTGRES_DB=postgres docker.io/library/postgres:16-alpine >/dev/null
    sleep 5
fi
podman run --rm --init --pod "$POD" -e HOST=127.0.0.1 -e USER=odoo -e PASSWORD=odoo \
    -v "$ADDONS:/mnt/extra-addons:ro,Z" "localhost/pos-freedelity-dev:$VERSION" \
    odoo -d "$DB" \
    --addons-path=/usr/lib/python3/dist-packages/odoo/addons,/mnt/extra-addons \
    -i pos_freedelity --without-demo=all --test-enable --test-tags "$TAGS" \
    --stop-after-init --log-level=test --http-port=8069 2>&1 | tee "/tmp/claude-1000/pos_freedelity-$VERSION.log" \
    | grep -E 'ERROR|FAIL|CRITICAL|Traceback|tests|test_|Ran |Starting|Assertion|Error' || true
podman run --rm --pod "$POD" -e PGPASSWORD=odoo docker.io/library/postgres:16-alpine \
    dropdb -h 127.0.0.1 -U odoo --if-exists "$DB" >/dev/null 2>&1 || true
