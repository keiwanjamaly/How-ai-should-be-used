# Obsidian AI Chat

Obsidian plugin that adds a right-sidebar chat panel for talking to LLMs.

Current backend strategy implementation:
- OpenRouter

Planned for later:
- LiteLLM proxy backend

## Setup

```bash
npm install
npm run build
```

The build output is `main.js` in the project root.

## Installation

Copy this folder to your vault's `.obsidian/plugins/` directory:

```bash
# From your vault's plugin folder
cp -r /path/to/this/folder .obsidian/plugins/obsidian-ai-chat
```

## Development

After editing:
```bash
npm run build
```

Then copy to vault:
```bash
rm -rf .obsidian/plugins/obsidian-ai-chat && cp -r /path/to/this/folder .obsidian/plugins/obsidian-ai-chat
```

## Hot Reload

For development without manual reloading:
1. Install the "Hot Reload" community plugin by pjeby
2. Edit files and run `npm run build`
3. Changes apply automatically
