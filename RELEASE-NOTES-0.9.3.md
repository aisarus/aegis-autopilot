# Aegis 0.9.3

- Increased Gemini Supervisor output budget from 192 to 1536 tokens.
- Added one automatic retry with a 3072-token budget when Gemini returns `incomplete`.
- `incomplete` no longer permanently puts an autopilot chat into the error state.
- Added detailed Gemini status, output length, and usage information to `aegis.log`.
