# prometheus-echonet-lite

A [Prometheus](https://prometheus.io/) exporter for [ECHONET Lite](https://echonet.jp/english/) home energy and environmental devices.

Supported device classes include distribution panel meters, solar power generation, water flow meters, electric water heaters, and home air conditioners.

## Metrics

Once running, the full list of exposed metrics — including names, types, and descriptions — is available directly from the exporter:

```
curl http://localhost:9095/metrics
```

Each metric line is preceded by a `# HELP` comment and a `# TYPE` declaration.

## Requirements

- Node.js 20+
- Network access to the ECHONET Lite devices (same LAN segment or multicast-reachable)

## Configuration

Copy and edit `config.json`:

```json
{
    "server": {
        "address": "0.0.0.0",
        "port": "9095"
    },
    "echonet": {
        "netif": "auto",
        "discoveryIntervalSecs": 300,
        "discoveryDurationSecs": 10,
        "epcTimeoutSecs": 5
    },
    "meters": {
        "192.168.1.10": {
            "name": "my-panel",
            "circuits": {
                "1": "Kitchen",
                "2": "Living room"
            }
        }
    }
}
```

### Options

| Key | Default | Description |
|---------------------------------|-----------|----------------------------------|
| `server.address`                | `0.0.0.0` | Address the HTTP server binds to |
| `server.port`                   | `9095`    | Port the HTTP server listens on  |
| `echonet.netif`                 | `auto`    | Local IP address to bind to. `"auto"` selects the first non-loopback IPv4 interface automatically. Set to an explicit IP (e.g. `"192.168.1.5"`) on multi-homed hosts. |
| `echonet.discoveryIntervalSecs` | `300`     | How often (seconds) to run a fresh device discovery sweep |
| `echonet.discoveryDurationSecs` | `10`      | How long (seconds) each discovery window stays open |
| `echonet.epcTimeoutSecs`        | `5`       | Per-request timeout (seconds) when querying device properties |
| `meters`                        | —         | Optional map of device IP → `name` and `circuits` used to populate `meter_name` and `circuit_name` labels |

## Running

### Development

```bash
npm install
npm run dev
```

### Production (compiled)

```bash
npm install
npm run build
node dist/index.js
```

### Docker

```bash
docker build -t prometheus-echonet-lite .
docker run -p 9095:9095 prometheus-echonet-lite
```

To use a custom config file:

```bash
docker run -p 9095:9095 \
  -v $(pwd)/config.json:/usr/src/app/config.json:ro \
  prometheus-echonet-lite
```

## Logging

Log verbosity is controlled by the `LOG_LEVEL` environment variable.

|  Value  |                      Output                       |
|---------|---------------------------------------------------|
| `debug` | All messages including per-request EPC traces     |
| `info`  | Discovery, startup, and shutdown events (default) |
| `warn`  | Unexpected but non-fatal conditions               |
| `error` | Errors only                                       |

```bash
LOG_LEVEL=debug node dist/index.js
```

## Prometheus scrape config

```yaml
scrape_configs:
  - job_name: echonet
    static_configs:
      - targets: ['localhost:9095']
```

## Development

Available npm scripts are defined in `package.json`. Key ones:

```bash
npm run build   # compile TypeScript to dist/
npm run dev     # run via ts-node without a build step
npm run lint    # ESLint
npm test        # run the test suite
```
