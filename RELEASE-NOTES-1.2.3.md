# Aegis 1.2.3

## Conversation-bound verified send

- Every queued send is bound to the intended ChatGPT conversation URL and durable conversation ID.
- A send is successful only after a new user turn containing the intended text appears in that same conversation.
- The Enter fallback is forbidden after ChatGPT has consumed the composer, preventing duplicate sends while the new turn is still rendering.
- Direct user-turn scanning no longer depends on the general conversation-history adapter.
