# ADR-006: Node.js / TypeScript over other languages

**Status:** Accepted
**Date:** 2026-07-04

**Context:** Four microservices plus an AI agent integration need a language. This is a solo
project, and I'm comfortable across several languages — Python, Go, and C# were all realistic
options — but Dapr's HTTP API is language-agnostic anyway, so nothing about Dapr forces a
particular choice here.

**Decision:** TypeScript and Node.js, with Fastify as the HTTP framework.

**Rationale:** The AI/LLM ecosystem in this space is mature (Google's Generative AI SDK, LangChain,
prompt tooling), and using one language across every service means shared types and no
polyglot overhead — a type defined once in `shared/` is the same type everywhere. Fastify gives a
production-grade HTTP server with schema validation, logging hooks, and a plugin system out of the
box. Since Dapr's HTTP API doesn't require its SDK, any language would technically work, but a
typed wrapper over those HTTP calls in TypeScript gets compile-time safety without pulling in extra
abstraction. And the UI runs on Vite, which fits naturally into the same JS/TS toolchain as
everything else.

Python with FastAPI has the strongest AI ecosystem of the three, but choosing it would have meant
a separate language just for the UI, splitting the codebase into two toolchains instead of one.
Go is a strong fit for microservices in general, but its AI SDK story is weaker, which would push
AI work into a second service written in something else entirely. C# has genuinely first-class
Dapr SDK support, but its AI ecosystem trails the others, and — like Python — it would still mean
the UI lives in a separate language and toolchain from the backend.

**Consequences:** One language and one toolchain end to end, plus a solid npm ecosystem for
testing (Vitest), building (esbuild), and CI. The one real caveat is that Node.js is
single-threaded, so anything CPU-bound — like generating embeddings — has to be kept off the main
event loop, via worker threads or a separate process, rather than run inline.
