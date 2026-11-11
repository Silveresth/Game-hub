#!/bin/sh
# Le disque persistant est souvent monté en root : on le donne à l'utilisateur node, puis on abandonne les droits root.
set -e
chown -R node:node /app/server/data 2>/dev/null || true
exec su-exec node "$@"
