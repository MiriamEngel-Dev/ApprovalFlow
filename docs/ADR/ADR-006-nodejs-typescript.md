# ADR-006: Node.js / TypeScript over other languages

**Context:** Four microservices plus an AI agent integration need a language. This is a solo
project, and the language I know best is JavaScript/TypeScript — and Dapr's HTTP API is
language-agnostic anyway, so nothing about Dapr forces a particular choice here.

**Decision:** TypeScript and Node.js, with Fastify as the HTTP framework.

**Rationale:** The AI/LLM ecosystem in this space is mature (Google's Generative AI SDK, LangChain,
prompt tooling), and using one language across every service means shared types and no
polyglot overhead — a type defined once in `shared/` is the same type everywhere. Fastify gives a
production-grade HTTP server with schema validation, logging hooks, and a plugin system out of the
box. Since Dapr's HTTP API doesn't require its SDK, any language would technically work, but a
typed wrapper over those HTTP calls in TypeScript gets compile-time safety without pulling in extra
abstraction. And the UI runs on Vite, which fits naturally into the same JS/TS toolchain as
everything else.

Python with FastAPI would have had the strongest AI ecosystem, but I'm less fluent in it, and it
would have meant a separate language just for the UI. Go is a strong fit for microservices in
general but has a weaker AI SDK story, which would push AI work into a second service written in
something else entirely. C# has genuinely first-class Dapr SDK support, but it's the language I
know least well of the three, and its AI ecosystem trails the others too.

**Consequences:** One language and one toolchain end to end, plus a solid npm ecosystem for
testing (Vitest), building (esbuild), and CI. The one real caveat is that Node.js is
single-threaded, so anything CPU-bound — like generating embeddings — has to be kept off the main
event loop, via worker threads or a separate process, rather than run inline.
