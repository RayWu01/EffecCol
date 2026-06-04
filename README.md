# EffecCol

[English](./README.md) | [简体中文](./README.zh-CN.md)

> Turn passive bookmarks into active knowledge capture.

EffecCol is a Chrome extension plus an Obsidian plugin. It turns a good web page into something you can still remember, find, and use later.

## Why EffecCol exists

Most bookmarking tools solve storage, not retrieval.

You save a page because it feels useful, but a few days later you may no longer remember why it mattered, what it said, or where it belongs in your thinking. The result is a growing archive that feels heavy, underused, and slightly stressful.

EffecCol was built for a different outcome:

1. save the full source into your knowledge base
2. keep a lighter summary card for your own index or workflow
3. make saved material easier to resurface and reuse

That is why the project is called **EffecCol**: short for **Effective Collection**.

## Who it is for

EffecCol is for people who:

- already use Obsidian as a long-term archive
- save many articles, posts, and references but rarely revisit them on their own
- feel anxious about a growing knowledge archive that they are not actively reviewing
- keep their own index, MOC, board, outline, or dashboard
- want one-click capture without filling in forms every time

If you only want a simple bookmark manager, EffecCol is probably more structured than you need.

## What problem it solves

EffecCol solves the gap between "I saved it" and "I can use it later."

One click produces two outputs with different jobs:

- a structured Obsidian note for archive and full reference
- a lighter clipboard card for manual placement in your own system

This separation is intentional. The archive and the index should not be the same thing.

## How it works

When you click the extension icon on a page, EffecCol will:

1. extract the title, URL, site, selection, and main article body
2. generate an AI summary
3. save a structured note into the current Obsidian vault under `EffecCol/`
4. copy a lighter knowledge card to the clipboard

The capture flow stays quiet:

- no popup form
- no jump to Obsidian
- no extra confirmation on each save

## What you get

### Obsidian note

The saved note is for long-term storage. It includes:

- frontmatter / properties
- page title
- AI summary
- cleaned article body
- source link
- downloaded article images when available

### Clipboard card

The clipboard card is for manual placement into your own working context. Depending on settings, it can include:

- bold title
- AI summary
- Obsidian note path
- Obsidian deep link
- source URL

You can paste this card into any place you use as an index, not only Obsidian.

## Current status

EffecCol is an open-source **v1 prototype**.

What that means today:

- the core flow works
- installation is still manual
- Obsidian desktop must stay open during capture
- article extraction and image handling are still being improved
- GitHub release packages are available for manual installation
- browser store and Obsidian community distribution are not finished yet

## Installation

Follow this order for a clean first-time setup.

### Before you start

- a Chromium-based browser
- Obsidian desktop
- one Obsidian vault you want EffecCol to save into
- Community plugins enabled in Obsidian
- an API key for your chosen AI provider

### 1. Open the target vault in Obsidian

Open Obsidian desktop first and make sure the vault you want to use is already open.

EffecCol saves into the currently opened vault, so this step should happen before you test the extension.

### 2. Install the Obsidian plugin

Copy `obsidian-plugin/effecol/` into your vault here:

```text
.obsidian/plugins/effecol/
```

If `.obsidian/plugins/` does not exist yet, create it first.

Then enable `EffecCol` in Obsidian:

1. Open `Settings`
2. Go to `Community plugins`
3. If Restricted mode is on, turn it off
4. Find `EffecCol`
5. Turn it on

After that, keep Obsidian open.

### 3. Load the Chrome extension

1. Open `chrome://extensions`
2. Turn on Developer Mode
3. Click `Load unpacked`
4. Select the `extension/` folder in this repository

Do not select the repository root. Chrome should load the folder that directly contains `manifest.json`.

### 4. Configure AI in the extension

Open the extension settings page and fill in:

- AI provider
- API key

Optional settings include:

- model
- endpoint
- summary length
- summary preference
- clipboard card preset

### 5. Run the first capture test

1. Keep Obsidian open
2. Open a normal `http` or `https` article page in Chrome
3. Click the EffecCol extension icon

If everything is set up correctly:

- a note will be saved into `EffecCol/` inside your current vault
- a clipboard card will be copied for manual paste

If the first capture fails, the most common causes are:

- Obsidian is not open
- the `EffecCol` Obsidian plugin is not enabled
- the wrong folder was loaded in Chrome
- the AI provider or API key is not configured yet

## Privacy and data flow

- Obsidian notes are written locally through the Obsidian plugin.
- API keys are stored locally in the browser.
- Extracted page content is sent only to the AI provider you configure, and only for summary generation.
- Clipboard writing happens locally in the browser.

## Repository structure

- `extension/`
  Chrome extension source, including `manifest.json`, background flow, settings page, status page, offscreen clipboard document, and icons
- `obsidian-plugin/effecol/`
  Obsidian plugin for local save
- `docs/TEST_REPORT.md`
  local manual testing notes
- `scripts/bridge-server.js`
  earlier bridge prototype kept for reference
- `release-assets/`
  local zip packages used for manual release testing

## Roadmap

- better article extraction across more sites
- better low-value page detection
- smoother first-run onboarding
- browser store and community distribution packaging
- more reliable image downloading and rendering

## Contributing

Issues and pull requests are welcome.

Helpful contribution areas right now:

- article extraction edge cases
- image handling across different sites
- onboarding and setup clarity
- release engineering

Project docs:

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [SECURITY.md](./SECURITY.md)
- [CHANGELOG.md](./CHANGELOG.md)
- [LICENSE](./LICENSE)

## In one sentence

EffecCol is not about collecting more. It is about collecting in a way that stays usable.
