# Hello World Panel

Obsidian plugin that shows a "Hello World" panel on the right side.

## Setup

```bash
npm install
npm run build
```

## Installation

Copy this folder to your vault's `.obsidian/plugins/` directory:

```bash
# From your vault's plugin folder
cp -r /path/to/this/folder .obsidian/plugins/hello-world-panel
```

## Development

After editing:
```bash
npm run build
```

Then copy to vault:
```bash
rm -rf .obsidian/plugins/hello-world-panel && cp -r /path/to/this/folder .obsidian/plugins/hello-world-panel
```

## Hot Reload

For development without manual reloading:
1. Install the "Hot Reload" community plugin by pjeby
2. Edit files and run `npm run build`
3. Changes apply automatically
