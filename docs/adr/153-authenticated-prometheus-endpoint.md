# ADR-153 — Authenticated Prometheus endpoint for the admin host

## Status

Accepted — 2026-09-17

## Context

The repository already provides a bounded, label-controlled `MetricsRegistry`,
but the admin HTTP host had no scrape endpoint. Operators had to invent a
separate adapter, and production metrics could not be verified at the process
boundary.

## Decision

`runAdmin` accepts an injected `MetricsRegistry` and exposes its redacted
Prometheus text at `GET /metrics`. The endpoint is absent when no registry is
configured. A caller-supplied `metricsAuthorize` callback protects scrapes;
binding metrics on a non-loopback host without that callback fails before boot.
The endpoint never serializes request bodies, run payloads or credentials.

## Evidence boundary

The admin journey test proves a real HTTP scrape on loopback and rejects an
unauthorized non-loopback boot. Host-level network isolation, Prometheus
configuration and metric cardinality policy remain deployment responsibilities.
