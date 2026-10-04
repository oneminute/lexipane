# AI provider strategy

LexiPane is model-agnostic. Reading features call semantic tasks and never depend directly on one vendor SDK.

## Live adapters

- **Ollama** — first-class local runtime, model discovery, streaming, vision, and model capability inspection.
- **OpenAI-compatible** — configurable local/self-hosted/cloud endpoints.
- **Anthropic native** — text, streaming, model metadata, and vision.
- **Gemini native** — text, streaming, model metadata, and vision.

The provider registry also catalogs other major local/global/China provider families.

## Provider configuration

A provider connection stores:

- provider family
- display name
- base URL
- selected model
- enabled state
- optional input price per 1M tokens
- optional output price per 1M tokens

API keys are stored separately in the operating system credential store.

Provider cards expose readiness checks, connection tests, model discovery, and capability inspection.

## Model capabilities

The common capability model tracks:

- text
- vision
- structured output
- streaming
- tools
- embeddings
- context window

Capability sources can be provider metadata, an explicit probe, or compatible-model inference.

For Ollama, LexiPane inspects the installed model through Ollama's model-info endpoint. Region/image routing also checks vision capability before sending an image whenever reliable capability metadata is available.

## Routing

Every semantic task may have an independent route plan:

~~~text
Primary
Fallback 1
Fallback 2
~~~

Tasks currently include:

- automatic difficulty
- contextual explanation
- grammar
- reader question
- region/image

A transient failure can be retried according to the task's execution policy before moving to the next route.

Structured-output validation is part of success: invalid JSON/schema output can fall through to the next configured model.

## Execution policy

Per-task policy includes:

- timeout
- retry count
- retry delay behavior

LexiPane retries transient conditions such as timeouts, selected rate-limit/server failures, and network interruptions. It avoids retrying obvious authentication/client configuration errors and structured-schema failures on the same route.

## Privacy

Global modes:

- Local only
- Prefer local
- Automatic
- Cloud only

Each book may override that mode.

Each book may also narrow providers with an allow-only or deny list. Provider filtering happens before reading content is sent.

## Structured contracts

Text tasks render structured cards instead of arbitrary model prose.

Region/image analysis returns:

- content type
- summary
- extracted visible text when reliable
- key points
- visual details

## Usage and pricing

Token counts and latency are stored locally when providers expose usage.

For cloud cost estimates, users may enter current input/output rates per one million tokens for a configured provider/model. This is intentionally user-controlled because commercial model pricing changes independently of LexiPane releases.

The settings UI summarizes:

- total tokens
- average latency
- local vs cloud request counts
- estimated total cost
- estimated cost today
- estimated cost this month

## Ollama default

Default local endpoint:

`http://127.0.0.1:11434`

When no model has been selected, LexiPane prefers an installed Qwen 3.5 model, then another Qwen model, then the first available model. The exact model identifier is not hard-coded.
