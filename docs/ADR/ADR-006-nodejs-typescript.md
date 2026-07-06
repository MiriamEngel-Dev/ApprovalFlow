# ADR-006: Node.js / TypeScript over other languages

**Context:** Must choose a language for four microservices + AI agent integration. Team
familiarity: JavaScript/TypeScript. Dapr supports HTTP API (language-agnostic).

**Decision:** TypeScript + Node.js with Fastify.

**Rationale:**
- Mature AI/LLM ecosystem (Google Generative AI SDK, LangChain, prompt templating)
- Single language across all services — shared types, no polyglot overhead
- Fastify provides production-grade HTTP server with schema validation, logging hooks,
  and plugin system
- Dapr HTTP API (REST) removes need for Dapr SDK — any language works, but TypeScript
  typed wrapper over HTTP calls gives compile-time safety with minimal abstraction
- Vite dev server for UI complements the JS/TS toolchain

**Alternatives considered:**
- Python (FastAPI) — best AI ecosystem, but team less familiar; would need a separate
  UI language
- Go — excellent for microservices, but weak AI SDK ecosystem; would need a separate AI
  service in Python or TypeScript
- C# — Dapr has first-class .NET SDK, but team least familiar; AI ecosystem trailing

**Consequences:**
- ✅ One language, one toolchain, one hiring profile
- ✅ Rich npm ecosystem for testing (Vitest), build (esbuild), and CI
- ⚠️ Node.js single-threaded — CPU-bound AI work (embedding generation) must not block
  the event loop; offloaded via worker threads or separate process
