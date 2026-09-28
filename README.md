# Static Marketing Site Starter

Build marketing sites with Claude Code. No coding required.

## What is this?

A Next.js template designed specifically for building marketing websites with Claude Code inside Ship Studio. Just describe what you want to build, and Claude handles all the code.

## Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Start the development server**
   ```bash
   npm run dev
   ```

3. **Open Claude Code and start building**

   Just describe what you want:
   - "Create a landing page for my coffee shop"
   - "I need a portfolio site with a contact form"
   - "Build a pricing page with three tiers"

## Available Commands

| Command | Description |
|---------|-------------|
| `/onboarding` | Set up a new project. Claude asks about your business and creates a personalized build plan. |
| `/page-remake` | Rebuild from an example. Share a URL you like, and Claude creates something similar. |
| `/sanity-cms` | Add editable content. When you want to update text yourself without touching code. |

## How It Works

1. **Start a conversation** - Just type what you want to build
2. **Claude builds it** - All the code is handled for you
3. **Refine together** - Ask for changes until it's perfect

## Project Structure

```
app/
├── layout.tsx       # Page wrapper (fonts, metadata)
├── page.tsx         # Homepage
├── globals.css      # Global styles
└── [folders]/       # Other pages (about/, contact/, etc.)
components/          # Reusable pieces
public/              # Images and files
```

## Design Philosophy

This starter follows **Human-First Design Principles**:

- **Intentional** - Every design choice has a reason
- **Distinctive** - Not a copy of common patterns
- **Memorable** - Something visitors remember
- **Human** - Warm and approachable

## Documentation

- **CLAUDE.md** - Instructions for Claude Code (how to build your site)
- **SITE.md** - Your project documentation (created during onboarding)

## Tech Stack

- [Next.js 14+](https://nextjs.org/) - React framework
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [Google Fonts](https://fonts.google.com/) - Typography

## Deploy

Deploy to Vercel with one click:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

Or deploy manually:
```bash
npm run build
npm start
```

---

Built for use with [Claude Code](https://claude.com/claude-code)
