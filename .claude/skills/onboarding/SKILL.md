---
name: onboarding
description: Guided discovery flow for new Ship Studio projects. Asks about business, audience, brand personality, and goals to create a personalized SITE.md and build plan.
user_invocable: true
---

# Onboarding Skill

This skill guides new users through project setup by asking smart questions and creating a personalized foundation for their marketing site.

## When to Trigger

**Automatically run this skill when:**
- The user starts a new conversation AND `SITE.md` doesn't exist
- The user says "start over" or "new project"
- The user explicitly asks to run onboarding

## Discovery Flow

Walk through these questions conversationally (not as a rigid form). Adapt based on answers.

### 1. Business Basics
- "What's the name of your business or project?"
- "In one sentence, what do you do?" (This becomes the tagline foundation)
- "What's your website's primary goal?" (Options: Get leads/signups, Sell products/services, Build credibility/portfolio, Inform/educate visitors)

### 2. Target Audience
- "Who are you trying to reach?" (Be specific: "busy parents" not "everyone")
- "What problem do they have that you solve?"
- "Where are they in their journey?" (Aware of problem? Comparing solutions? Ready to buy?)

### 3. Brand Personality
Pick ONE from each pair - this defines the voice:
- **Formal** vs **Casual** (Are you a law firm or a surf shop?)
- **Playful** vs **Serious** (Can you use humor or is it life-and-death?)
- **Luxury** vs **Accessible** (Premium feel or friendly neighbor?)
- **Bold** vs **Understated** (Loud and proud or quiet confidence?)

### 4. Visual Direction
- "Share 1-3 websites you love the look of" (even outside your industry)
- "Any colors you're drawn to or want to avoid?"
- "What vibe fits your brand?" (Options: Modern & minimal, Warm & approachable, Bold & energetic, Elegant & refined, Creative & artistic, Professional & trustworthy)

### 5. Pages Needed
- "What pages does your site need?"
- Common options: Homepage (required), About, Services/Products, Pricing, Contact, Blog, FAQ, Testimonials
- "Any specific sections on the homepage?" (Hero, features, testimonials, pricing, FAQ, CTA)

### 6. Content & Assets
- "Do you have a logo?" (Yes/No/Need one designed)
- "Do you have brand photos or will we use placeholders?"
- "Any existing copy/text you want to use?"

## Output: SITE.md

After gathering answers, create `SITE.md` with this structure:

```markdown
# [Business Name]

> [One-sentence description/tagline]

## About This Site

**Primary Goal:** [Lead generation / Sales / Portfolio / Information]
**Target Audience:** [Specific description]
**Problem We Solve:** [What pain point do we address]

## Brand Identity

### Personality
- **Tone:** [Formal/Casual]
- **Style:** [Playful/Serious]
- **Feel:** [Luxury/Accessible]
- **Energy:** [Bold/Understated]

### Visual Direction
- **Vibe:** [Modern minimal / Warm approachable / etc.]
- **Inspiration:** [Sites they mentioned]
- **Colors:** [Any preferences mentioned]

## Site Structure

### Pages
- **Homepage** (`/`) - [description of planned sections]
- **[Other pages]** (`/[route]`) - [description]

### Homepage Sections (planned)
1. [List planned sections in order]

## Content Status

- [ ] Logo: [Have it / Need it / Using placeholder]
- [ ] Photos: [Have them / Using placeholders]
- [ ] Copy: [Have it / Need to write it]

## Build Plan

Based on your answers, here's the recommended build order:

1. **First:** [Most important thing based on their goal]
2. **Then:** [Next priority]
3. **Finally:** [Nice-to-haves]

---

*This file is your site's source of truth. Claude updates it after every change.*
```

## After Creating SITE.md

1. Summarize what you learned in plain English
2. Present the build plan with clear first steps
3. Ask: "Ready to start building? What should we tackle first?"

## Conversation Style

- Be warm and encouraging - they're building something they care about
- Explain WHY you're asking each question
- Give examples to help them think
- If they seem unsure, offer suggestions based on their industry
- Never overwhelm with too many questions at once
- Celebrate their answers: "Great choice!" "That's really clear!"

## Example Opening

"Hey! Let's get to know your project so I can build something perfect for you.

First - what's the name of your business? And in one sentence, what do you do? (This helps me understand your world.)"
