# Obsidian AI Chat

Obsidian AI Chat adds a right sidebar chat panel to Obsidian so you can talk to LLMs without leaving your vault.

This is an early desktop-only release intended for friends, testers, and anyone comfortable trying a work-in-progress plugin.

## Features

- Chat from a sidebar view inside Obsidian
- Use OpenRouter models with your own API key
- Optionally include the active note as context in the conversation
- Stream responses directly into the chat UI
- Upload PDFs for OCR through the configured OpenRouter model

## Requirements

- Obsidian `1.6.0` or newer
- Desktop only
- An OpenRouter API key

## Install with BRAT

The easiest way to try this plugin before community-store submission is with the BRAT plugin.

1. Install the `BRAT` community plugin in Obsidian
2. Open `BRAT` settings
3. Choose `Add Beta plugin`
4. Paste this repository URL:

```text
https://github.com/keiwanjamaly/How-ai-should-be-used
```

5. Install the latest release

## Manual installation

1. Download the latest release assets
2. Create this folder in your vault:

```text
<Vault>/.obsidian/plugins/obsidian-ai-chat
```

3. Copy these files into that folder:

```text
manifest.json
main.js
styles.css
```

4. Reload Obsidian and enable `Obsidian AI Chat` in Community Plugins

## Setup

1. Open the plugin settings
2. Paste your OpenRouter API key
3. Choose a model
4. Open the chat sidebar and start chatting

## Privacy and external services

This plugin sends data to OpenRouter when you use it.

- Your prompts are sent to OpenRouter
- If note context is enabled, the active note content is sent with your request
- If you use PDF upload, the selected PDF is sent to OpenRouter for OCR/extraction
- API keys and chat session data are stored in the plugin data inside your vault's Obsidian config

Only use the plugin with data you are comfortable sending to the configured external service.

## Development

```bash
npm install
npm run build
```

The build output is `main.js` in the project root.

For local development, copy `main.js`, `manifest.json`, and `styles.css` into your vault plugin folder after each build.

## Releasing

The repository includes an automatic GitHub Actions release workflow that builds the plugin and publishes the required Obsidian assets whenever a pushed commit bumps the plugin version.

1. Bump the release version in `package.json`, `manifest.json`, and `versions.json`, or use:

```bash
npm run release:prepare -- 0.1.1
```

2. Review the changed files:

```bash
git diff package.json package-lock.json manifest.json versions.json
```

3. Commit and push the version bump to GitHub.
4. The `Release On Version Bump` workflow will run automatically.

The workflow validates the version metadata, detects whether the version changed from the previous commit, runs checks and tests, builds the plugin, creates the GitHub release tag, and uploads `manifest.json`, `main.js`, and `styles.css`.

Releases from `develop`, versions starting with `0.`, and versions with a prerelease suffix such as `0.2.0-rc1` are published as GitHub prereleases automatically.

## Status

This project is still under active development. Expect rough edges, breaking changes, and incomplete features between releases.

## License

MIT
