#!/usr/bin/env python3
"""Fill secret values in .env (creating it from .env.example if needed)."""
import pathlib, re, secrets
root = pathlib.Path(__file__).resolve().parent.parent
env = root / ".env"
if not env.exists():
    env.write_text((root / ".env.example").read_text()); print("created .env from .env.example")
text = env.read_text()
def setk(t, k, v):
    if re.search(rf"(?m)^{k}=", t): return re.sub(rf"(?m)^{k}=.*$", f"{k}={v}", t)
    return t + f"\n{k}={v}"
smap = {"CREDS_KEY": secrets.token_hex(32), "CREDS_IV": secrets.token_hex(16),
    "JWT_SECRET": secrets.token_hex(32), "JWT_REFRESH_SECRET": secrets.token_hex(32),
    "LF_ENCRYPTION_KEY": secrets.token_hex(32), "LF_SALT": secrets.token_hex(16),
    "LF_NEXTAUTH_SECRET": secrets.token_hex(32)}
for k, v in smap.items(): text = setk(text, k, v)
env.write_text(text)
print("secrets written to .env:", ", ".join(smap))
print("NOTE: still set AGENT_LLM_API_KEY, AGENT_RO_PASSWORD, and Langfuse keys.")
