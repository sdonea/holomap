---
name: page-remake
description: Remake and improve existing web pages from URL examples. Use when user provides a URL and asks to "remake", "rebuild", "recreate", or "use as inspiration" for their site. Screenshots the original, analyzes branding, and rebuilds section-by-section.
user_invocable: true
---

# Page Remake Skill

This skill transforms existing web pages into your own version. It captures the essence of the original and rebuilds it in your codebase.

## When to Trigger

**Automatically run this skill when user says:**
- "Remake this page: [URL]"
- "Start from this example: [URL]"
- "I want my site to look like this: [URL]"
- "Rebuild this: [URL]"
- "Use this as inspiration: [URL]"
- "Make my site like [URL]"
- "Copy the style of [URL]"
- "Recreate this: [URL]"

**Also trigger when:**
- User shares a URL and asks you to "replicate", "mirror", or "build something similar"
- User says "I like this website" followed by a URL
- User provides a screenshot and says "make it like this"

---

## Phase 1: Screenshot the Original

### Using Playwright MCP

Navigate to the URL and capture a full-page screenshot:

```
1. Use browser_navigate to go to the URL
2. Wait for the page to fully load (give it a moment for images/animations)
3. Use browser_screenshot to capture the full page
4. Save screenshot to public/references/ for ongoing comparison
```

### Screenshot Storage

Create the references directory if it doesn't exist:
```
public/
└── references/
    └── original-[sitename]-[date].png
```

**Tell the user:** "I'm taking a screenshot of [URL] so I can study its design. This will be my reference as I rebuild each section."

---

## Phase 1.5: Choose Your Approach

After capturing the screenshot, ask the user which approach they prefer:

> "I've captured the original. How should I approach this remake?
>
> **Option 1: Exact Remake**
> Recreate each section as closely as possible—same structure, layout, content patterns.
> Best if: You love the original and just need it in your codebase.
>
> **Option 2: Same Brand, Fresh Build**
> Keep the fonts, colors, and brand feel. May reorganize or improve layouts.
> Best if: You want the brand identity but are open to improvements.
>
> **Option 3: Inspired Remake** (Recommended)
> Capture the essence but apply thoughtful design choices—distinctive fonts, optimized layouts, better copy.
> Best if: You want something that feels similar but with intentional improvements."

Wait for the user's choice before proceeding.

---

## Phase 2: Analyze & Create Brand Document

After capturing the screenshot, perform a detailed visual analysis.

### What to Analyze

Study the screenshot carefully and document:

1. **Color Palette**
   - Primary color (dominant brand color)
   - Secondary colors (supporting tones)
   - Accent color (CTAs, highlights)
   - Background colors (sections, cards)
   - Text colors (headings vs body)

2. **Typography**
   - Heading font style (serif, sans-serif, display)
   - Body text style
   - Font weights used
   - Letter spacing patterns
   - Text sizes hierarchy

3. **Layout Patterns**
   - Hero style (full-width, split, minimal)
   - Section structures (how content is organized)
   - Grid patterns (columns, asymmetry)
   - Spacing rhythm (tight, generous, varied)
   - Visual flow (Z-pattern, F-pattern, scrolling)

4. **Visual Elements**
   - Image treatment (photography style, filters)
   - Icons (style, consistency, usage)
   - Decorative elements (shapes, lines, backgrounds)
   - Buttons/CTAs (shape, style, hover states)

5. **Brand Messaging**
   - Tone of voice (formal/casual, serious/playful)
   - Key value propositions
   - Target audience signals
   - Emotional appeal

6. **Section Inventory**
   - List each section from top to bottom
   - Note the purpose of each section
   - Document layout/structure of each

### Create BRAND-ANALYSIS.md

Save this to the project root:

```markdown
# Brand Analysis: [Original Site Name/URL]

> Analysis created [date] for page remake project

## Source
- **URL:** [the URL analyzed]
- **Screenshot:** public/references/original-[name]-[date].png

## Remake Approach
- **Selected:** [Exact / Same Brand / Inspired]
- **Font Handling:** [Match exactly / Find closest Google Font / Claude's choice]
- **Color Handling:** [Match exactly / Match palette / Optimize]
- **Layout Handling:** [Replicate faithfully / Preserve structure / Optimize freely]

## Brand Overview

### Inferred Business Type
[What kind of business/product this appears to be]

### Target Audience
[Who they seem to be targeting - demographics, psychographics]

### Brand Personality
- **Tone:** [Formal / Casual / Technical / Friendly / Authoritative]
- **Energy:** [Bold / Understated / Playful / Serious / Energetic / Calm]
- **Feel:** [Luxury / Accessible / Premium / Budget-friendly]
- **Style:** [Modern / Traditional / Minimalist / Maximalist / Creative]

## Color Palette

| Role | Hex | Usage |
|------|-----|-------|
| Primary | #_____ | [where it's used] |
| Secondary | #_____ | [where it's used] |
| Accent | #_____ | [where it's used] |
| Background (main) | #_____ | [where it's used] |
| Background (alt) | #_____ | [where it's used] |
| Text (primary) | #_____ | [where it's used] |
| Text (secondary) | #_____ | [where it's used] |

### Color Notes
[Any gradients, special treatments, or patterns]

## Typography

### Headings
- **Style:** [Serif / Sans-Serif / Display / Handwritten]
- **Weight:** [Light / Regular / Bold / Black]
- **Character:** [Geometric / Humanist / Modern / Classic]
- **Identified Font:** [if recognizable]
- **Google Font Alternative:** [suggest closest match]

### Body Text
- **Style:** [Serif / Sans-Serif]
- **Readability:** [Compact / Generous spacing]
- **Identified Font:** [if recognizable]
- **Google Font Alternative:** [suggest closest match]

### Typography Hierarchy
[Note size relationships, spacing patterns]

## Section-by-Section Breakdown

### Section 1: [Name - e.g., "Hero"]
- **Purpose:** [What this section achieves]
- **Layout:** [Describe structure - split, centered, asymmetric]
- **Key Elements:** [What's included - headline, image, CTA, etc.]
- **Visual Notes:** [Any special treatments, animations, effects]

### Section 2: [Name]
[Repeat for each section...]

### Section 3: [Name]
...

## Visual Elements

### Images
- **Style:** [Photography / Illustration / Mixed]
- **Treatment:** [Full color / Duotone / Black & white / Filtered]
- **Subject Matter:** [People / Product / Abstract / Lifestyle]

### Icons
- **Style:** [Line / Filled / Duotone / Custom]
- **Consistency:** [Unified set / Mixed sources]

### Decorative Elements
- **Shapes:** [Geometric / Organic / None]
- **Backgrounds:** [Solid / Gradient / Textured / Pattern]
- **Dividers:** [Lines / Waves / Angles / None]

## Messaging Analysis

### Key Headlines/Copy
[Quote notable headlines or copy patterns]

### Value Propositions
1. [Main value prop]
2. [Secondary value prop]
3. [Tertiary value prop]

### CTA Patterns
- **Primary CTA:** [Text and style]
- **Secondary CTA:** [Text and style]

## Improvement Opportunities

### What Works Well
- [Strength 1]
- [Strength 2]
- [Strength 3]

### Areas for Improvement
- [Opportunity 1]
- [Opportunity 2]
- [Opportunity 3]

---

*This analysis guides the remake. Reference it during each section build.*
```

---

## Phase 3: Handle SITE.md

Before building, check for existing SITE.md and ask the user how to proceed.

### If SITE.md EXISTS

Ask the user:

> "I found an existing SITE.md with your project information. How would you like to proceed?
>
> **Option A: Merge** - I'll blend insights from [URL] with your existing brand identity
>
> **Option B: Fresh Start** - I'll create a new SITE.md based entirely on [URL]'s brand analysis
>
> Which do you prefer?"

**If Merge:** Update SITE.md by adding insights from BRAND-ANALYSIS.md while preserving existing business info, goals, and preferences.

**If Fresh Start:** Create new SITE.md using BRAND-ANALYSIS.md as the foundation, but still ask key business questions from onboarding skill.

### If SITE.md DOES NOT EXIST

Create SITE.md using the brand analysis as the visual foundation:

> "I've analyzed [URL] and understand the visual direction. Before I start building, I need to know a bit about YOUR business so the copy and messaging are accurate.
>
> Quick questions:
> 1. What's your business name?
> 2. In one sentence, what do you do?
> 3. Who are you trying to reach?"

Then create SITE.md with:
- Business info from user
- Visual direction from BRAND-ANALYSIS.md
- Font choices based on selected approach
- Color palette based on selected approach

---

## Phase 4: Section-by-Section Rebuild

Build each section one at a time, referencing the original screenshot.

### Approach-Specific Guidelines

#### For Exact Remake
- Replicate layouts faithfully
- Match colors as closely as possible
- Find closest Google Font matches for typography
- Preserve content structure and hierarchy
- Skip improvement suggestions during build

#### For Same Brand, Fresh Build
- Use original fonts/colors exactly or find closest matches
- Preserve the overall brand feel
- May suggest layout improvements if beneficial
- Keep content patterns but improve copy where helpful
- Focus on maintaining brand consistency

#### For Inspired Remake (Recommended)
- Full creative freedom with design choices
- Apply human-first design principles
- Choose distinctive fonts that match the brand feel
- Optimize layouts for clarity and impact
- Improve copy following copywriting skill guidelines

### For EACH Section:

#### 1. Reference the Original
Look at how the original handled this section:
- What's the layout structure?
- What content is included?
- What's the visual treatment?

#### 2. Apply Selected Approach Rules
Based on user's choice:
- **Exact:** Match faithfully
- **Same Brand:** Keep identity, consider improvements
- **Inspired:** Capture essence, apply best practices

#### 3. Write Copy

Use copywriting skill guidelines:
- No overused words (revolutionize, leverage, seamless, etc.)
- Specific, concrete language
- Focus on outcomes, not features
- Human-sounding tone

For **Exact** remakes, follow the original copy patterns more closely.
For **Inspired** remakes, feel free to improve significantly.

#### 4. Implement the Section

Use react-nextjs-expert patterns:
- Proper component structure
- Tailwind CSS only (no separate CSS files)
- Responsive design
- Accessible markup

### Section Build Order

1. **Hero** - Sets the tone for everything
2. **Social Proof Bar** - Early credibility (if original has one)
3. **Main Content Sections** - Features, benefits, how it works
4. **Testimonials** - Social proof
5. **Final CTA** - Conversion section
6. **Navbar** - Navigation (do this alongside hero)
7. **Footer** - Links and secondary info

### After Each Section

Tell the user what you built:
> "I just rebuilt the [Section Name]. Here's what I kept from the original and what I changed: [brief summary]"

---

## Phase 5: Quality Verification

After rebuilding all sections:

### Compare with Original

1. Review the rebuilt page against the original screenshot
2. Check that the brand essence was captured
3. Verify approach-specific requirements were met
4. Ensure the rebuilt version meets the user's expectations

### Checklist

**For All Approaches:**
- [ ] Brand feel is captured
- [ ] Colors work well together
- [ ] Typography hierarchy is clear
- [ ] Copy is specific and human-sounding
- [ ] Mobile responsive
- [ ] Accessible (proper headings, alt text, contrast)

**For Exact Remakes:**
- [ ] Layouts closely match original
- [ ] Color palette matches
- [ ] Font choices are as close as possible
- [ ] Content structure preserved

**For Inspired Remakes:**
- [ ] At least one distinctive design choice per section
- [ ] Layout has visual interest
- [ ] Typography feels intentional
- [ ] Human-first design principles applied

### Final Report to User

> "I've finished rebuilding [original URL]. Here's a summary:
>
> **Approach Used:** [Exact / Same Brand / Inspired]
>
> **Sections Built:** [list]
>
> **Key Decisions:**
> - [Decision 1]
> - [Decision 2]
> - [Decision 3]
>
> **Files Created/Modified:**
> - [File list]
>
> You can preview your rebuilt site at [localhost URL]. Compare it to the original!"

---

## Integration with Other Skills

This skill orchestrates multiple other skills:

| Skill | When to Use |
|-------|-------------|
| **brand-identity** | Check all color/font choices |
| **copywriting** | Write all text content (headlines, body, CTAs) |
| **marketing-site-design** | Section architecture and conversion patterns |
| **frontend-design** | Visual implementation and creative direction |
| **react-nextjs-expert** | Code implementation patterns |
| **documentation-writer** | Update SITE.md after completion |

---

## Conversation Style

- Be enthusiastic about the remake process
- Explain your analysis in simple terms
- Show the user you understand what they liked about the original
- Highlight changes you're making and why
- Keep them informed as you build each section
- Celebrate the final result

### Example Opening

> "Great choice! I'm going to remake [URL] for you. Here's my plan:
>
> 1. First, I'll screenshot the original so I have a reference
> 2. Then I'll ask how closely you want me to follow it
> 3. I'll analyze everything - colors, fonts, layout, messaging
> 4. I'll create a brand document so we're both on the same page
> 5. Then I'll rebuild it section by section
>
> Let me start by capturing that screenshot..."

---

## Error Handling

### If Playwright MCP is not available:
> "I need to take a screenshot of the original page, but it looks like the screenshot tool isn't set up. You can either:
> 1. Take a screenshot yourself and share it with me
> 2. Describe what you like about the page
> 3. Share the URL and I'll analyze it as best I can from context
>
> Which would you prefer?"

### If URL is inaccessible:
> "I couldn't access [URL]. This might be because:
> - The site requires login
> - It's blocking automated access
> - The URL has a typo
>
> Can you check the URL or take a screenshot and share it with me?"

### If original uses highly unique elements:
> "The original site uses [custom illustrations/specific photography/unique elements] that I can't replicate exactly. I'll substitute with [alternative approach] that maintains the same feel. Sound good?"

---

## Files Created

| File | Location | Purpose |
|------|----------|---------|
| `BRAND-ANALYSIS.md` | Project root | Detailed analysis of original |
| Original screenshot | `public/references/` | Visual reference during build |
| `SITE.md` | Project root | Updated/created project documentation |
| Page components | `app/` and `components/` | The rebuilt page |
