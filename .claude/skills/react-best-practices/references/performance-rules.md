# React Performance Rules - Full Reference

## 1. Eliminating Waterfalls (CRITICAL)

### 1.1 Defer Await Until Needed

Move `await` operations into the branches where they're actually used.

```typescript
// BAD: blocks both branches
async function handleRequest(userId: string, skipProcessing: boolean) {
  const userData = await fetchUserData(userId)
  if (skipProcessing) {
    return { skipped: true }  // Still waited for userData
  }
  return processUserData(userData)
}

// GOOD: only blocks when needed
async function handleRequest(userId: string, skipProcessing: boolean) {
  if (skipProcessing) {
    return { skipped: true }  // Returns immediately
  }
  const userData = await fetchUserData(userId)
  return processUserData(userData)
}
```

### 1.2 Promise.all() for Independent Operations

```typescript
// BAD: sequential - 3 round trips
const user = await fetchUser()
const posts = await fetchPosts()
const comments = await fetchComments()

// GOOD: parallel - 1 round trip
const [user, posts, comments] = await Promise.all([
  fetchUser(),
  fetchPosts(),
  fetchComments()
])
```

### 1.3 API Route Optimization

```typescript
// BAD: config waits for auth
export async function GET(request: Request) {
  const session = await auth()
  const config = await fetchConfig()
  const data = await fetchData(session.user.id)
  return Response.json({ data, config })
}

// GOOD: auth and config start immediately
export async function GET(request: Request) {
  const sessionPromise = auth()
  const configPromise = fetchConfig()
  const session = await sessionPromise
  const [config, data] = await Promise.all([
    configPromise,
    fetchData(session.user.id)
  ])
  return Response.json({ data, config })
}
```

### 1.4 Strategic Suspense Boundaries

```tsx
// BAD: wrapper blocked by data
async function Page() {
  const data = await fetchData()
  return (
    <div>
      <Header />
      <DataDisplay data={data} />
      <Footer />
    </div>
  )
}

// GOOD: wrapper shows immediately
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

async function DataDisplay() {
  const data = await fetchData()
  return <div>{data.content}</div>
}
```

## 2. Bundle Size Optimization (CRITICAL)

### 2.1 Avoid Barrel File Imports

Barrel files can have up to 10,000 re-exports, taking 200-800ms to import.

```tsx
// BAD: imports entire library
import { Check, X, Menu } from 'lucide-react'
import { Button, TextField } from '@mui/material'

// GOOD: direct imports
import Check from 'lucide-react/dist/esm/icons/check'
import X from 'lucide-react/dist/esm/icons/x'
import Button from '@mui/material/Button'
```

Or use Next.js optimizePackageImports:
```js
// next.config.js
module.exports = {
  experimental: {
    optimizePackageImports: ['lucide-react', '@mui/material']
  }
}
```

### 2.2 Dynamic Imports for Heavy Components

```tsx
// BAD: Monaco bundles with main chunk (~300KB)
import { MonacoEditor } from './monaco-editor'

// GOOD: Monaco loads on demand
import dynamic from 'next/dynamic'

const MonacoEditor = dynamic(
  () => import('./monaco-editor').then(m => m.MonacoEditor),
  { ssr: false }
)
```

### 2.3 Defer Non-Critical Libraries

```tsx
// BAD: blocks initial bundle
import { Analytics } from '@vercel/analytics/react'

// GOOD: loads after hydration
import dynamic from 'next/dynamic'

const Analytics = dynamic(
  () => import('@vercel/analytics/react').then(m => m.Analytics),
  { ssr: false }
)
```

### 2.4 Preload Based on User Intent

```tsx
function EditorButton({ onClick }: { onClick: () => void }) {
  const preload = () => {
    if (typeof window !== 'undefined') {
      void import('./monaco-editor')
    }
  }

  return (
    <button onMouseEnter={preload} onFocus={preload} onClick={onClick}>
      Open Editor
    </button>
  )
}
```

## 3. Server-Side Performance (HIGH)

### 3.1 React.cache() for Per-Request Deduplication

```typescript
import { cache } from 'react'

export const getCurrentUser = cache(async () => {
  const session = await auth()
  if (!session?.user?.id) return null
  return await db.user.findUnique({
    where: { id: session.user.id }
  })
})
```

### 3.2 LRU Cache for Cross-Request Caching

```typescript
import { LRUCache } from 'lru-cache'

const cache = new LRUCache<string, any>({
  max: 1000,
  ttl: 5 * 60 * 1000  // 5 minutes
})

export async function getUser(id: string) {
  const cached = cache.get(id)
  if (cached) return cached

  const user = await db.user.findUnique({ where: { id } })
  cache.set(id, user)
  return user
}
```

### 3.3 Minimize Serialization at RSC Boundaries

```tsx
// BAD: serializes all 50 fields
async function Page() {
  const user = await fetchUser()  // 50 fields
  return <Profile user={user} />
}

// GOOD: serializes only needed fields
async function Page() {
  const user = await fetchUser()
  return <Profile name={user.name} avatar={user.avatar} />
}
```

### 3.4 Parallel Data Fetching with Composition

```tsx
// BAD: Sidebar waits for Header
export default async function Page() {
  const header = await fetchHeader()
  return (
    <div>
      <div>{header}</div>
      <Sidebar />
    </div>
  )
}

// GOOD: both fetch simultaneously
async function Header() {
  const data = await fetchHeader()
  return <div>{data}</div>
}

async function Sidebar() {
  const items = await fetchSidebarItems()
  return <nav>{items.map(renderItem)}</nav>
}

export default function Page() {
  return (
    <div>
      <Header />
      <Sidebar />
    </div>
  )
}
```

### 3.5 Use after() for Non-Blocking Operations

```tsx
import { after } from 'next/server'

export async function POST(request: Request) {
  await updateDatabase(request)

  // Log after response is sent
  after(async () => {
    logUserAction({ userAgent: request.headers.get('user-agent') })
  })

  return Response.json({ status: 'success' })
}
```

## 4. Re-render Optimization (MEDIUM)

### 4.1 Use Functional setState

```tsx
// BAD: creates new function every render
onClick={() => setCount(count + 1)}

// GOOD: stable reference
onClick={() => setCount(c => c + 1)}
```

### 4.2 Extract to Memoized Components

```tsx
const ExpensiveList = memo(function ExpensiveList({ items }) {
  return items.map(item => <ExpensiveItem key={item.id} {...item} />)
})
```

### 4.3 Lazy State Initialization

```tsx
// BAD: expensive computation on every render
const [data] = useState(expensiveComputation())

// GOOD: only computed once
const [data] = useState(() => expensiveComputation())
```

### 4.4 Use Transitions for Non-Urgent Updates

```tsx
import { useTransition } from 'react'

function SearchResults({ query }) {
  const [isPending, startTransition] = useTransition()
  const [results, setResults] = useState([])

  function handleSearch(query) {
    startTransition(() => {
      setResults(filterResults(query))
    })
  }
}
```

## 5. Rendering Performance (MEDIUM)

### 5.1 CSS content-visibility for Long Lists

```css
.list-item {
  content-visibility: auto;
  contain-intrinsic-size: 0 50px;
}
```

### 5.2 Hoist Static JSX

```tsx
// BAD: recreated every render
function Component() {
  const icon = <Icon />
  return <div>{icon}</div>
}

// GOOD: created once
const icon = <Icon />
function Component() {
  return <div>{icon}</div>
}
```

### 5.3 Explicit Conditional Rendering

```tsx
// BAD: may render 0 instead of nothing
{items.length && <List items={items} />}

// GOOD: explicit null
{items.length > 0 ? <List items={items} /> : null}
```

## 6. JavaScript Performance (LOW-MEDIUM)

### 6.1 Use Set/Map for O(1) Lookups

```tsx
// BAD: O(n) lookup
const isSelected = selectedIds.includes(id)

// GOOD: O(1) lookup
const selectedSet = new Set(selectedIds)
const isSelected = selectedSet.has(id)
```

### 6.2 Cache Property Access in Loops

```tsx
// BAD: property access on each iteration
for (let i = 0; i < arr.length; i++) {
  process(arr[i])
}

// GOOD: cached length
for (let i = 0, len = arr.length; i < len; i++) {
  process(arr[i])
}
```

### 6.3 Early Return from Functions

```tsx
// BAD: nested conditions
function process(data) {
  if (data) {
    if (data.valid) {
      return transform(data)
    }
  }
  return null
}

// GOOD: early returns
function process(data) {
  if (!data) return null
  if (!data.valid) return null
  return transform(data)
}
```

## References

- [Vercel Blog: Package Import Optimization](https://vercel.com/blog/how-we-optimized-package-imports-in-next-js)
- [Next.js after() API](https://nextjs.org/docs/app/api-reference/functions/after)
- [better-all Library](https://github.com/shuding/better-all)
- [LRU Cache](https://github.com/isaacs/node-lru-cache)
