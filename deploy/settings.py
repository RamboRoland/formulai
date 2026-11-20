# The production settings for the Droplet, from the deploy workflow's
# GitHub secrets / variables (environment) — no settings file is kept on
# the server by hand. Writes into <out dir>:
#   server.env  → ~/formulai/server/.env (the server's env_file)
#   Caddyfile   → ~/formulai/deploy/Caddyfile (deploy/Caddyfile with its
#                 {$NAME} placeholders filled in)
# Any setting missing or empty → fails before anything is written, so the
# server never starts without its keys or Caddy without basic auth.
# Values never printed.
#   python3 deploy/settings.py <out dir>
import os
import sys
from pathlib import Path

SERVER = ['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID',
          'S3_SECRET_ACCESS_KEY', 'EDITOR_PASSWORD', 'LOG_INCIDENTS']
CADDY = ['APP_DOMAIN', 'BASIC_AUTH_USER', 'BASIC_AUTH_HASH']

# Fixed for production (not settings).
SERVER_FIXED = {
    'S3_FORCE_PATH_STYLE': 'false',  # Spaces: bucket in the host name
    'FAST_LOBBIES': 'false',         # fast training takes a whole core: run it locally
}


def main():
    out = Path(sys.argv[1])
    missing = [name for name in SERVER + CADDY if not os.environ.get(name)]
    if missing:
        sys.exit(f'settings missing (GitHub secrets / variables): {", ".join(missing)}')
    # Single quotes: env_file takes the value as it is ($ included).
    bad = [name for name in SERVER + CADDY if "'" in os.environ[name] or '\n' in os.environ[name]]
    if bad:
        sys.exit(f'settings with a single quote or a line break: {", ".join(bad)}')

    out.mkdir(parents=True, exist_ok=True)
    os.umask(0o077)
    values = {name: os.environ[name] for name in SERVER} | SERVER_FIXED
    (out / 'server.env').write_text(''.join(f"{name}='{value}'\n" for name, value in values.items()))

    caddyfile = (Path(__file__).parent / 'Caddyfile').read_text()
    for name in CADDY:
        caddyfile = caddyfile.replace('{$' + name + '}', os.environ[name])
    if '{$' in caddyfile:
        sys.exit('deploy/Caddyfile has a {$...} placeholder settings.py does not fill')
    (out / 'Caddyfile').write_text(caddyfile)


main()
