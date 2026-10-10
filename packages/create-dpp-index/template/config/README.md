Put a signed publisher policy chain here when you need multiple publishers or key rotation. Set `PUBLISHER_POLICY_FILE=config/publisher-policy.json` and supply independently trusted `OPERATOR_IDENTITY_KEYS`. The runtime verifies the chain at startup. Keep the history, not just the newest policy.

The default project uses a single publisher public key and needs no policy file. No publisher, operator or wallet private key belongs in this directory.
