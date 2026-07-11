# Dummy environment so the scripts import cleanly during tests.
# The tests only exercise pure functions, so no real credentials are ever used.
import os

os.environ.setdefault('DNS_DOMAIN', 'example.com')
os.environ.setdefault('CLOUDFLARE_API_TOKEN', 'cf_dummy')
os.environ.setdefault('CLOUDFLARE_ZONE_ID', 'zone_dummy')
os.environ.setdefault('DRY_RUN', 'true')
