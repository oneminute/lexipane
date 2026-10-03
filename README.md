# LexiPane

**LexiPane** is a cross-platform AI-assisted ebook reader designed for deep reading and language learning.

The product combines a modern reader with contextual AI assistance: difficult words and phrases, sentence grammar, passage explanations, region/image analysis, annotations, notes, and a personal reading model that adapts over time.

## Product direction

- Desktop: Windows, macOS, Linux
- Mobile: iOS, Android
- Formats: PDF first, then EPUB, MOBI/AZW/AZW3 and other common ebook formats
- Split reading: source text + structured AI assistance
- AI: local and cloud providers through a model-agnostic provider/router layer
- Local-first data: SQLite for books, reading position, annotations, notes and settings
- Privacy modes: local-only, prefer-local, automatic, cloud-only

## Planned AI providers

Local:
- Ollama
- LM Studio
- llama.cpp server
- vLLM
- LocalAI
- generic OpenAI-compatible endpoints

Cloud:
- OpenAI
- Anthropic Claude
- Google Gemini
- xAI Grok
- OpenRouter
- Alibaba Qwen / Model Studio
- DeepSeek
- Moonshot / Kimi
- Zhipu / GLM
- MiniMax
- ByteDance / Doubao
- Baidu ERNIE / Qianfan
- Tencent Hunyuan
- generic OpenAI-compatible endpoints

The first local target is Ollama, including Qwen-family models.

## Initial architecture

```text
LexiPane
├─ Document Engine
│  ├─ PDF
│  ├─ EPUB
│  └─ MOBI/AZW
├─ Annotation Engine
├─ Notebook Engine
├─ AI Platform
│  ├─ Provider Registry
│  ├─ Model Registry
│  ├─ Task Router
│  ├─ Prompt Templates
│  ├─ Structured Output
│  ├─ Usage / Cost
│  └─ Privacy Policy
└─ Personal Reading Model
```

## Stack

- Tauri 2
- React
- TypeScript
- Rust
- Vite
- SQLite

The repository is currently being initialized. See `docs/architecture.md` and `docs/roadmap.md` as the implementation lands.
