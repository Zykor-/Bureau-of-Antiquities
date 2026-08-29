# Bureau of Antiquities

Guild project hub for the Bureau of Antiquities in RUIN.

## What it does

- Shows every active guild project at a glance
- Displays player, set/project name, and all needed items without opening a card
- Lets guild members add and edit projects from the website
- Marks completed projects as complete in Airtable so they disappear from the active board
- Records Q1–Q10 for found components and calculates the live 9.50-average Q10 requirement
- Resolves each nested assembled subset from its direct components, then counts that subset's resulting quality once in its parent set
- Provides a codeword-protected Field Intelligence registry for guild alts and hunt targets
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
| Q10 Set | Checkbox |
| Assembled Item | Link to Assembled Items |
| Collected Components | Link to Items |
| Component Qualities | Long text (website-managed JSON) |

Create an Airtable personal access token with record read/write permission for only this base.

Field Intelligence uses two additional tables:

| Table | Fields |
| --- | --- |
| Alt Accounts | Alt Account, Main Account, List Type, Notes, Active |
| Guild Access | Member, Access Code, Enabled |

Access codes belong only in Airtable. The Worker validates them server-side, returns no access records to the browser, and does not create a login session or persist the entered code.

## Required Cloudflare secrets/variables

The Worker expects:

- `AIRTABLE_TOKEN` — encrypted Worker secret
- `AIRTABLE_BASE_ID` — the Airtable base ID

The Airtable table variables default to `Projects`, `Alt Accounts`, and `Guild Access` in `wrangler.jsonc`.

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
