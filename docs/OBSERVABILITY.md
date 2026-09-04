# Observability

Required production signals:

- structured logs;
- correlation IDs;
- event-processing metrics;
- reconciliation metrics;
- queue depth;
- forecast latency;
- agent tool latency;
- model inference latency;
- optimizer latency;
- error rate;
- health and readiness checks.

Performance targets:

- dashboard summary API P95 under 500 ms;
- common transaction queries P95 under 300 ms;
- simple financial agent query under 5 s;
- reconciliation event processing under 2 s.
