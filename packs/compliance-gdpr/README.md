# @aqa/pack-compliance-gdpr

Provider-neutral GDPR privacy baseline for applications that expose explicit
privacy workflows. It covers three high-risk journeys:

- subject access request acceptance and safe retry;
- consent withdrawal becoming effective;
- erasure request acceptance and post-erasure access blocking.

The endpoints and fixture subject are intentionally conventional placeholders.
Adapt them to the SUT and run against a seeded, non-production tenant. A
passing local fixture does not prove legal compliance, lawful basis, retention
policy, processor contracts, DSAR deadline handling, or erasure across external
systems.

Enable it by tagging a profile/project with `compliance-gdpr` or by explicitly
installing the pack. Never point it at production personal data.
