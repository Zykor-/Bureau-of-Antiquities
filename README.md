# Bureau of Antiquities

Guild project hub for the Bureau of Antiquities in RUIN.

## What it does

- Shows every active guild project at a glance
- Displays player, set/project name, and all needed items without opening a card
- Lets guild members add and edit projects from the website
- Marks completed projects as complete in Airtable so they disappear from the active board
- Includes search and mobile-friendly layout

## Stack

- Static HTML/CSS/JavaScript frontend
- Cloudflare Worker for secure Airtable access
- Airtable as the database
- GitHub Actions deployment to Cloudflare

## Airtable setup

Create a base with a table named `Projects` and these fields:

| Field | Type |
| --- | --- |
| Owner | Single line text |
| Project | Single line text |
| Items | Long text |
| Completed | Checkbox |

Create an Airtable personal access token with record read/write permission for only this base.

## Required Cloudflare secrets/variables

The Worker expects:

- `AIRTABLE_TOKEN` — encrypted Worker secret
- `AIRTABLE_BASE_ID` — the Airtable base ID

`AIRTABLE_PROJECTS_TABLE` defaults to `Projects` in `wrangler.jsonc`.

For local development, create `.dev.vars`:

```text
AIRTABLE_TOKEN=your_token_here
AIRTABLE_BASE_ID=your_base_id_here
```

Then run:

```bash
npm install
npm run dev
```

## Automatic deployment

The included GitHub Action deploys every push to `main` to Cloudflare. Add these repository secrets in GitHub before the workflow can deploy:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Then add `AIRTABLE_TOKEN` as a secret on the deployed Cloudflare Worker and set `AIRTABLE_BASE_ID` as a Worker variable.

## Current design

The site uses a medium-dark antique-gold palette with scavenged-loot styling and a boa-inspired guild mark. The interface is deliberately simple so it can grow later into a broader guild hub without rebuilding the project system.
