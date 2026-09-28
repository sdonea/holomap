---
name: animations
description: Create gorgeous micro-interactions and animations using Framer Motion. Use this skill when adding motion to components, page transitions, scroll animations, or any interactive elements that need polish.
---

# Animations Skill

This skill guides the creation of beautiful, purposeful animations using Framer Motion. Great animations feel natural, add delight, and improve user experience.

## When to Use This Skill

- Adding hover states and micro-interactions
- Creating page transitions
- Animating elements on scroll
- Building loading states and skeletons
- Creating staggered list animations
- Adding entrance animations to sections
- Building interactive UI elements

## Philosophy

**Animations should be:**
- **Purposeful** - Every animation communicates something
- **Subtle** - Enhancement, not distraction
- **Fast** - Users shouldn't wait for animations
- **Consistent** - Same timing and easing throughout

**Avoid:**
- Animations that block user action
- Motion for motion's sake
- Jarring or unexpected movements
- Inconsistent timing across the site

---

## Setup

### Install Framer Motion

```bash
npm install framer-motion
```

### Basic Import

```tsx
"use client";
import { motion } from "framer-motion";
```

---

## Timing & Easing Reference

### Standard Durations

| Type | Duration | Use Case |
|------|----------|----------|
| Micro | 0.1-0.15s | Button hovers, icon changes |
| Fast | 0.2-0.3s | Fade ins, small movements |
| Medium | 0.3-0.5s | Page elements, cards |
| Slow | 0.5-0.8s | Page transitions, large elements |

### Recommended Easings

```tsx
// Smooth and natural
const easeOut = [0.33, 1, 0.68, 1];

// Snappy entrance
const easeOutBack = [0.34, 1.56, 0.64, 1];

// Elegant deceleration
const easeOutExpo = [0.16, 1, 0.3, 1];

// Springy feel
const spring = { type: "spring", stiffness: 300, damping: 30 };
```

---

## Animation Patterns

### 1. Fade In on Mount

```tsx
<motion.div
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  transition={{ duration: 0.3 }}
>
  Content
</motion.div>
```

### 2. Fade Up on Mount

```tsx
<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.4, ease: [0.33, 1, 0.68, 1] }}
>
  Content
</motion.div>
```

### 3. Staggered Children

```tsx
const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 }
};

<motion.ul variants={container} initial="hidden" animate="show">
  {items.map((item) => (
    <motion.li key={item.id} variants={item}>
      {item.content}
    </motion.li>
  ))}
</motion.ul>
```

### 4. Hover Scale

```tsx
<motion.button
  whileHover={{ scale: 1.02 }}
  whileTap={{ scale: 0.98 }}
  transition={{ duration: 0.15 }}
>
  Click me
</motion.button>
```

### 5. Hover with Background Change

```tsx
<motion.a
  className="relative px-4 py-2 overflow-hidden"
  whileHover="hover"
>
  <motion.span
    className="absolute inset-0 bg-black/5"
    initial={{ scale: 0 }}
    variants={{ hover: { scale: 1 } }}
    transition={{ duration: 0.3 }}
  />
  <span className="relative">Link text</span>
</motion.a>
```

### 6. Scroll-Triggered Animation

```tsx
import { motion, useInView } from "framer-motion";
import { useRef } from "react";

function Section({ children }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <motion.section
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, ease: [0.33, 1, 0.68, 1] }}
    >
      {children}
    </motion.section>
  );
}
```

### 7. Page Transition Wrapper

```tsx
// components/PageTransition.tsx
"use client";
import { motion } from "framer-motion";

export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3, ease: [0.33, 1, 0.68, 1] }}
    >
      {children}
    </motion.div>
  );
}
```

### 8. Expandable Card

```tsx
<motion.div
  layout
  className="bg-white rounded-lg p-4"
  onClick={() => setExpanded(!expanded)}
>
  <motion.h3 layout="position">Title</motion.h3>
  {expanded && (
    <motion.p
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      Expanded content here
    </motion.p>
  )}
</motion.div>
```

### 9. Loading Skeleton

```tsx
<motion.div
  className="h-4 bg-gray-200 rounded"
  animate={{ opacity: [0.5, 1, 0.5] }}
  transition={{ duration: 1.5, repeat: Infinity }}
/>
```

### 10. Menu/Dropdown

```tsx
import { AnimatePresence, motion } from "framer-motion";

<AnimatePresence>
  {isOpen && (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className="absolute top-full mt-2 bg-white shadow-lg rounded-lg"
    >
      {/* Menu content */}
    </motion.div>
  )}
</AnimatePresence>
```

---

## Reusable Components

### FadeIn Component

```tsx
"use client";
import { motion, Variants } from "framer-motion";
import { ReactNode } from "react";

interface FadeInProps {
  children: ReactNode;
  delay?: number;
  direction?: "up" | "down" | "left" | "right";
  className?: string;
}

export function FadeIn({
  children,
  delay = 0,
  direction = "up",
  className,
}: FadeInProps) {
  const directions = {
    up: { y: 20 },
    down: { y: -20 },
    left: { x: 20 },
    right: { x: -20 },
  };

  return (
    <motion.div
      initial={{ opacity: 0, ...directions[direction] }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{
        duration: 0.5,
        delay,
        ease: [0.33, 1, 0.68, 1],
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
```

### StaggeredList Component

```tsx
"use client";
import { motion } from "framer-motion";
import { ReactNode } from "react";

interface StaggeredListProps {
  children: ReactNode[];
  staggerDelay?: number;
  className?: string;
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      ease: [0.33, 1, 0.68, 1],
    },
  },
};

export function StaggeredList({
  children,
  staggerDelay = 0.1,
  className,
}: StaggeredListProps) {
  return (
    <motion.div
      variants={{
        ...container,
        show: {
          ...container.show,
          transition: { staggerChildren: staggerDelay },
        },
      }}
      initial="hidden"
      animate="show"
      className={className}
    >
      {children.map((child, index) => (
        <motion.div key={index} variants={item}>
          {child}
        </motion.div>
      ))}
    </motion.div>
  );
}
```

### AnimatedButton Component

```tsx
"use client";
import { motion } from "framer-motion";
import { ButtonHTMLAttributes, ReactNode } from "react";

interface AnimatedButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "secondary";
}

export function AnimatedButton({
  children,
  variant = "primary",
  className,
  ...props
}: AnimatedButtonProps) {
  const baseClasses =
    variant === "primary"
      ? "bg-black text-white"
      : "bg-white text-black border border-black/10";

  return (
    <motion.button
      className={`px-6 py-3 rounded-lg font-medium ${baseClasses} ${className}`}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.15 }}
      {...props}
    >
      {children}
    </motion.button>
  );
}
```

---

## Section-Specific Animations

### Hero Section

```tsx
// Stagger headline, subheadline, and CTA
const heroVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.15, delayChildren: 0.2 },
  },
};

const heroItemVariants = {
  hidden: { opacity: 0, y: 30 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.33, 1, 0.68, 1] },
  },
};
```

### Feature Cards

```tsx
// Stagger cards on scroll
const ref = useRef(null);
const isInView = useInView(ref, { once: true, margin: "-50px" });

<motion.div
  ref={ref}
  variants={containerVariants}
  initial="hidden"
  animate={isInView ? "show" : "hidden"}
  className="grid grid-cols-3 gap-6"
>
  {features.map((feature) => (
    <motion.div key={feature.id} variants={itemVariants}>
      {/* Card content */}
    </motion.div>
  ))}
</motion.div>
```

### Testimonials

```tsx
// Subtle float animation for quotes
<motion.blockquote
  animate={{ y: [0, -5, 0] }}
  transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
>
  {quote}
</motion.blockquote>
```

---

## Performance Tips

1. **Use `layout` sparingly** - It can be expensive. Only use when necessary.

2. **Prefer `transform` and `opacity`** - These are GPU-accelerated:
   ```tsx
   // Good
   animate={{ x: 10, opacity: 0.5 }}

   // Avoid
   animate={{ left: 10, width: 100 }}
   ```

3. **Set `will-change` for complex animations:**
   ```tsx
   <motion.div style={{ willChange: "transform" }} />
   ```

4. **Use `useReducedMotion` for accessibility:**
   ```tsx
   import { useReducedMotion } from "framer-motion";

   function Component() {
     const shouldReduceMotion = useReducedMotion();

     return (
       <motion.div
         animate={{ y: shouldReduceMotion ? 0 : 20 }}
       />
     );
   }
   ```

5. **Avoid animating on scroll without throttling** - Use `useInView` with `once: true`.

---

## Checklist Before Shipping

- [ ] Animations are fast (under 500ms for most)
- [ ] Consistent easing across the site
- [ ] Respects `prefers-reduced-motion`
- [ ] No layout shifts during animation
- [ ] Mobile performance tested
- [ ] Exit animations added where needed (AnimatePresence)
- [ ] Stagger delays feel natural, not too slow
