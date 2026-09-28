---
name: sanity-cms
description: On-demand Sanity CMS setup for editable content. Guides through initialization, schema creation, and Studio configuration. Triggers when user wants to make content editable.
user_invocable: true
---

# Sanity CMS Skill

This skill guides users through adding Sanity CMS to make their website content editable through a friendly admin interface.

## When to Trigger

- User asks to "add a CMS"
- User wants to "edit content without code"
- User mentions "content management"
- User asks about "making text/images editable"
- User wants to "update content themselves"

## What is Sanity? (Explain Simply)

> "Sanity is like a Google Doc for your website. You edit text and images in a friendly dashboard, and your website automatically updates. No coding needed after we set it up."

Key benefits for non-technical users:
- Edit text like a Word document
- Upload and manage images easily
- Changes go live instantly
- Can't break the website by editing content

---

## Setup Flow

### Step 1: Create Sanity Account

If they don't have Sanity set up yet:

> "First, let's get you a Sanity account. Go to **sanity.io** and sign up—it's free for small sites."

Wait for them to confirm account creation.

### Step 2: Initialize Sanity in Project

```bash
npx sanity@latest init --env
```

This will prompt for:
- Project name (use their site name)
- Default dataset configuration: Yes
- Project output path: `/sanity` or `/studio`
- TypeScript: Yes
- Package manager: npm

### Step 3: Install Next.js Dependencies

```bash
npm install next-sanity @sanity/image-url
```

### Step 4: Environment Variables

Create/update `.env.local`:

```env
NEXT_PUBLIC_SANITY_PROJECT_ID="[from sanity init]"
NEXT_PUBLIC_SANITY_DATASET="production"
NEXT_PUBLIC_SANITY_API_VERSION="2024-01-01"
```

### Step 5: Create Sanity Client

Create `lib/sanity.ts`:

```typescript
import { createClient } from 'next-sanity'
import imageUrlBuilder from '@sanity/image-url'

export const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET!,
  apiVersion: process.env.NEXT_PUBLIC_SANITY_API_VERSION!,
  useCdn: true,
})

const builder = imageUrlBuilder(client)

export function urlFor(source: any) {
  return builder.image(source)
}
```

---

## Common Schemas

### Homepage Schema

Create `sanity/schemas/homepage.ts`:

```typescript
import { defineType, defineField } from 'sanity'

export const homepage = defineType({
  name: 'homepage',
  title: 'Homepage',
  type: 'document',
  fields: [
    defineField({
      name: 'heroHeadline',
      title: 'Hero Headline',
      type: 'string',
      description: 'The main headline at the top of the page',
    }),
    defineField({
      name: 'heroSubheadline',
      title: 'Hero Subheadline',
      type: 'text',
      rows: 2,
      description: 'The smaller text below the headline',
    }),
    defineField({
      name: 'heroCtaText',
      title: 'Button Text',
      type: 'string',
      description: 'Text on the main call-to-action button',
    }),
    defineField({
      name: 'heroCtaLink',
      title: 'Button Link',
      type: 'string',
      description: 'Where the button goes when clicked',
    }),
    defineField({
      name: 'heroImage',
      title: 'Hero Image',
      type: 'image',
      options: { hotspot: true },
    }),
  ],
  preview: {
    prepare() {
      return { title: 'Homepage' }
    },
  },
})
```

### Features Schema

Create `sanity/schemas/feature.ts`:

```typescript
import { defineType, defineField } from 'sanity'

export const feature = defineType({
  name: 'feature',
  title: 'Feature',
  type: 'document',
  fields: [
    defineField({
      name: 'title',
      title: 'Feature Title',
      type: 'string',
    }),
    defineField({
      name: 'description',
      title: 'Description',
      type: 'text',
      rows: 3,
    }),
    defineField({
      name: 'icon',
      title: 'Icon Name',
      type: 'string',
      description: 'Icon identifier (e.g., "check", "star", "shield")',
    }),
    defineField({
      name: 'order',
      title: 'Display Order',
      type: 'number',
      description: 'Order to display (1 = first)',
    }),
  ],
  orderings: [
    {
      title: 'Display Order',
      name: 'orderAsc',
      by: [{ field: 'order', direction: 'asc' }],
    },
  ],
})
```

### Testimonials Schema

Create `sanity/schemas/testimonial.ts`:

```typescript
import { defineType, defineField } from 'sanity'

export const testimonial = defineType({
  name: 'testimonial',
  title: 'Testimonial',
  type: 'document',
  fields: [
    defineField({
      name: 'quote',
      title: 'Quote',
      type: 'text',
      rows: 4,
    }),
    defineField({
      name: 'authorName',
      title: 'Author Name',
      type: 'string',
    }),
    defineField({
      name: 'authorTitle',
      title: 'Author Title',
      type: 'string',
      description: 'e.g., "CEO at Company"',
    }),
    defineField({
      name: 'authorImage',
      title: 'Author Photo',
      type: 'image',
      options: { hotspot: true },
    }),
    defineField({
      name: 'featured',
      title: 'Featured',
      type: 'boolean',
      description: 'Show this testimonial prominently',
    }),
  ],
})
```

### Register Schemas

Update `sanity/schema.ts`:

```typescript
import { type SchemaTypeDefinition } from 'sanity'
import { homepage } from './schemas/homepage'
import { feature } from './schemas/feature'
import { testimonial } from './schemas/testimonial'

export const schema: { types: SchemaTypeDefinition[] } = {
  types: [homepage, feature, testimonial],
}
```

---

## Fetching Content

### Basic Page Query

```typescript
// app/page.tsx
import { client } from '@/lib/sanity'

async function getHomepageContent() {
  return client.fetch(`
    *[_type == "homepage"][0] {
      heroHeadline,
      heroSubheadline,
      heroCtaText,
      heroCtaLink,
      heroImage
    }
  `)
}

export default async function Home() {
  const content = await getHomepageContent()

  return (
    <section>
      <h1>{content?.heroHeadline || 'Welcome'}</h1>
      <p>{content?.heroSubheadline}</p>
      {/* ... */}
    </section>
  )
}
```

### With Images

```typescript
import { urlFor } from '@/lib/sanity'

// In component:
{content?.heroImage && (
  <img
    src={urlFor(content.heroImage).width(1200).url()}
    alt=""
  />
)}
```

---

## Running Sanity Studio

### Local Development

```bash
cd sanity && npm run dev
```

Studio runs at `http://localhost:3333`

### Explain to User

> "Now you have an editing dashboard! Go to **localhost:3333** in your browser. You'll see your content types (Homepage, Features, Testimonials). Click on one to edit it, then publish your changes."

---

## Common Tasks

### Adding a New Editable Section

1. Create schema in `sanity/schemas/[name].ts`
2. Register in `sanity/schema.ts`
3. Create fetch function in page/component
4. Add fallback values for empty content

### Making Existing Content Editable

1. Identify what should be editable
2. Create schema matching the content structure
3. Update component to fetch from Sanity
4. Keep existing values as fallbacks

### Deploying Studio

```bash
cd sanity && npx sanity deploy
```

This gives them a hosted Studio URL they can bookmark.

---

## Checklist for CMS Setup

- [ ] Sanity project initialized
- [ ] Environment variables set
- [ ] Sanity client created
- [ ] Schemas created for editable content
- [ ] Pages updated to fetch from Sanity
- [ ] Fallback values for empty content
- [ ] Studio accessible at localhost:3333
- [ ] User understands how to edit content

## Explaining to Non-Technical Users

After setup, explain:

> "Here's how to update your website now:
> 1. Go to [Studio URL] and log in
> 2. Click on 'Homepage' (or whatever you want to edit)
> 3. Change the text or images
> 4. Click 'Publish' in the bottom right
> 5. Your website updates automatically!
>
> You can't break anything—worst case, just undo your changes."
