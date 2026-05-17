# `examples/laravel-app`

Minimal Laravel 11 PHP app showing `agentic-qa-kit` against a non-JS
target. AQA itself runs on Bun/Node, but the **target under QA** can be
any HTTP-speaking server.

## Run

```bash
composer install
php artisan serve   # :8000
```

## QA

```bash
aqa run --profile api-core
aqa run --profile security
```

## Why this example exists

To make it concrete that `agentic-qa-kit` doesn't care about the target's
language. `pack-api-core` probes `GET /items/:id`, asserts status codes
and JSON shape; the Laravel routes implement the same contract a Bun
service would. Findings + replay artifacts work identically.
