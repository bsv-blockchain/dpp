Put a signed publisher policy chain here when you need multiple publishers or key rotation. Set `PUBLISHER_POLICY_FILE=config/publisher-policy.json` and supply independently trusted `OPERATOR_IDENTITY_KEYS`. The runtime verifies the chain at startup. Keep the history, not just the newest policy.

The default project uses a single publisher public key and needs no policy file. No publisher, operator or wallet private key belongs in this directory.

`publisher-tokens.json` is written here by `npm run connection` and by `npm run tokens -- issue`: the SHA-256 of each write token, the publisher key it belongs to, its use and its label, never the token itself. The index reads it live and accepts a token only for what its key signed. Keep the file out of version control; a revoked record stays in it so the token is refused as revoked.
