# The Postgres the CI service containers run (F203, Stage 6 item 0).
#
# GitHub Actions service containers cannot take a command, so the logical
# replication settings Electric needs (F201) are baked into the image's default
# command instead. The base is the same digest the workflows used before, so the
# only change is the three flags. Pinned by digest, per A007-T16.
FROM postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193

CMD ["postgres", "-c", "wal_level=logical", "-c", "max_replication_slots=10", "-c", "max_wal_senders=10"]
