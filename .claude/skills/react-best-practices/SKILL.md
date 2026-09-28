---
name: react-best-practices
description: React and Next.js performance optimization guidelines from Vercel Engineering. Use this skill when writing, reviewing, or refactoring React/Next.js code to ensure optimal performance patterns. Triggers on tasks involving React components, Next.js pages, data fetching, bundle optimization, or performance improvements.
---

# React Best Practices

Performance optimization guide for React and Next.js applications, based on Vercel Engineering guidelines. Contains 45 rules across 8 categories, prioritized by impact.

## When to Apply

Reference these guidelines when:
- Writing new React components or Next.js pages
- Implementing data fetching (client or server-side)
- Reviewing code for performance issues
- Refactoring existing React/Next.js code
- Optimizing bundle size or load times

## Rule Categories by Priority

| Priority | Category | Impact |
|----------|----------|--------|
| 1 | Eliminating Waterfalls | CRITICAL |
| 2 | Bundle Size Optimization | CRITICAL |
| 3 | Server-Side Performance | HIGH |
| 4 | Client-Side Data Fetching | MEDIUM-HIGH |
| 5 | Re-render Optimization | MEDIUM |
| 6 | Rendering Performance | MEDIUM |
| 7 | JavaScript Performance | LOW-MEDIUM |
| 8 | Advanced Patterns | LOW |

## Critical Rules Summary

### 1. Eliminating Waterfalls (CRITICAL)

**Waterfalls are the #1 performance killer.** Each sequential await adds full network latency.

```tsx
// BAD: Sequential - 3 round trips
const user = await fetchUser()
const posts = await fetchPosts()
const comments = await fetchComments()

// GOOD: Parallel - 1 round trip
const [user, posts, comments] = await Promise.all([
  fetchUser(),
  fetchPosts(),
  fetchComments()
])
```

**Use Suspense for streaming:**
```tsx
// GOOD: Layout shows immediately, data streams in
function Page() {
  return (
    <div>
      <Header />
      <Suspense fallback={<Skeleton />}>
        <DataDisplay />
      </Suspense>
      <Footer />
    </div>
  )
}
```

### 2. Bundle Size Optimization (CRITICAL)

**Avoid barrel file imports** (200-800ms import cost):
```tsx
// BAD: Imports entire library
import { Check, X } from 'lucide-react'

// GOOD: Direct imports
import Check from 'lucide-react/dist/esm/icons/check'
import X from 'lucide-react/dist/esm/icons/x'
```

**Dynamic imports for heavy components:**
```tsx
import dynamic from 'next/dynamic'

const HeavyEditor = dynamic(() => import('./Editor'), {
  loading: () => <Skeleton />,
  ssr: false
})
```

### 3. Server-Side Performance (HIGH)

**Use React.cache() for per-request deduplication:**
```tsx
import { cache } from 'react'

const getUser = cache(async (id: string) => {
  return await db.user.findUnique({ where: { id } })
})
```

**Minimize data passed to client components:**
```tsx
// BAD: Sends entire user object
<ClientComponent user={user} />

// GOOD: Send only what's needed
<ClientComponent userName={user.name} userId={user.id} />
```

### 4. Re-render Optimization (MEDIUM)

**Use functional setState for stable callbacks:**
```tsx
// BAD: Creates new function every render
onClick={() => setCount(count + 1)}

// GOOD: Stable reference
onClick={() => setCount(c => c + 1)}
```

**Extract expensive work into memoized components:**
```tsx
const ExpensiveList = memo(function ExpensiveList({ items }) {
  return items.map(item => <ExpensiveItem key={item.id} {...item} />)
})
```

## Full Reference

For detailed explanations and more examples, see [references/performance-rules.md](references/performance-rules.md).
