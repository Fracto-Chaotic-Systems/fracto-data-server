# Private data-service configuration

`mysql.json` contains this service's database connection settings and is ignored
by Git and Docker build contexts. Provision it locally from the existing settings
when upgrading; do not commit credentials. The environment registry reads this
service-owned file and supports `FRACTO_MYSQL_HOST`, `FRACTO_MYSQL_PORT`,
`FRACTO_MYSQL_DATABASE`, `FRACTO_MYSQL_USER` and `FRACTO_MYSQL_PASSWORD` overrides.
Production Compose mounts this directory read-only. All handlers and maintenance
commands read this service-owned configuration. Optional Wolfram operations use
`wolfram.json` here; it is also excluded from Git and Docker build contexts.
