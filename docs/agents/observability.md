# Observability configuration

Honne keeps observability local by default and sends no telemetry to third parties unless an instance explicitly opts in.

```yaml
platform: none
logger: slog
conventions: structured local events; stable names and fields; never log secrets
```
