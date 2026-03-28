FROM ghcr.io/postgresml/postgresml:2.9.3

# Switch to root to install new packages
USER root

# FIX 1: Delete the broken PostgresML update link so apt-get doesn't crash
RUN rm -f /etc/apt/sources.list.d/postgresml*.list

# FIX 2: Use the modern, secure way to add the TimescaleDB repository and key
RUN apt-get update && apt-get install -y lsb-release curl gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://packagecloud.io/timescale/timescaledb/gpgkey | gpg --dearmor -o /etc/apt/keyrings/timescaledb.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/timescaledb.gpg] https://packagecloud.io/timescale/timescaledb/ubuntu/ $(lsb_release -c -s) main" > /etc/apt/sources.list.d/timescaledb.list \
    && apt-get update \
    && apt-get install -y timescaledb-2-postgresql-15
