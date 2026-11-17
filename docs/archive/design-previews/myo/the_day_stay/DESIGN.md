---
name: The Day Stay
colors:
  surface: '#fff8f6'
  surface-dim: '#f9d1c8'
  surface-bright: '#fff8f6'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#fff1ed'
  surface-container: '#ffe9e4'
  surface-container-high: '#ffe2db'
  surface-container-highest: '#ffdad2'
  on-surface: '#2b1611'
  on-surface-variant: '#3d4850'
  inverse-surface: '#432a24'
  inverse-on-surface: '#ffede9'
  outline: '#6d7881'
  outline-variant: '#bdc8d2'
  surface-tint: '#09658c'
  primary: '#09658c'
  on-primary: '#ffffff'
  primary-container: '#71b6e1'
  on-primary-container: '#004764'
  inverse-primary: '#89cefb'
  secondary: '#9a4603'
  on-secondary: '#ffffff'
  secondary-container: '#fe9250'
  on-secondary-container: '#6e2f00'
  tertiary: '#086a63'
  on-tertiary: '#ffffff'
  tertiary-container: '#6dbcb3'
  on-tertiary-container: '#004b45'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#c6e7ff'
  primary-fixed-dim: '#89cefb'
  on-primary-fixed: '#001e2d'
  on-primary-fixed-variant: '#004c6b'
  secondary-fixed: '#ffdbc9'
  secondary-fixed-dim: '#ffb68e'
  on-secondary-fixed: '#331200'
  on-secondary-fixed-variant: '#763300'
  tertiary-fixed: '#a1f1e7'
  tertiary-fixed-dim: '#85d4cb'
  on-tertiary-fixed: '#00201d'
  on-tertiary-fixed-variant: '#00504a'
  background: '#fff8f6'
  on-background: '#2b1611'
  surface-variant: '#ffdad2'
typography:
  display-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 4.5rem
    fontWeight: '800'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 2.25rem
    fontWeight: '700'
    lineHeight: '1.2'
  body-xl:
    fontFamily: Be Vietnam Pro
    fontSize: 1.25rem
    fontWeight: '500'
    lineHeight: '1.6'
  body-md:
    fontFamily: Be Vietnam Pro
    fontSize: 1rem
    fontWeight: '400'
    lineHeight: '1.5'
  label-bold:
    fontFamily: Be Vietnam Pro
    fontSize: 0.875rem
    fontWeight: '700'
    letterSpacing: 0.05em
rounded:
  sm: 0.5rem
  DEFAULT: 1rem
  md: 1.5rem
  lg: 2rem
  xl: 3rem
  full: 9999px
spacing:
  container-max: 80rem
  section-gap: 4rem
  bento-gap: 1.5rem
  inline-padding: 1rem
  header-height: 4.5rem
  nav-height: 6rem
---

## Brand & Style
The brand personality is energetic, nurturing, and premium. It targets discerning pet owners who value high-quality, supervised care for their animals. The UI evokes a sense of "organized joy"—balancing the chaotic energy of a dog park with the sophisticated reliability of a luxury hotel.

The design style is **Modern Tactile**, blending elements of **Glassmorphism** (backdropped-blurred headers and navigation) with high-vibrancy color gradients. It uses a "Bento Box" layout logic to organize information into digestible, playful containers, creating a structured yet approachable interface that feels both contemporary and warm.

## Colors
The palette is rooted in an "Earth & Sky" concept. The primary blue (#006289) provides a professional, calming foundation, while the secondary burnt orange (#974300) adds warmth and energy. 

The background uses a soft, tinted "Peach Fuzz" white (#fff4f2) rather than pure white, which reduces eye strain and reinforces the organic, friendly vibe. Gradients are used specifically for high-priority actions and sections, transitioning from a deep "Deep Sea" blue to a vibrant "Cyan Sky" to guide the user's eye toward booking and key calls to action.

## Typography
Typography is highly hierarchical. **Plus Jakarta Sans** is reserved for headlines to provide a friendly, geometric personality. For the brand logo "myo.", use a black-weight italic to imply movement.

**Be Vietnam Pro** handles all functional text and body copy, chosen for its high legibility and warm, contemporary feel. Tight letter spacing is used on large displays to maintain visual impact, while generous line height in body text ensures information about pet care is easy to scan.

## Layout & Spacing
The layout follows a 12-column grid system with a maximum width of 1280px (7xl). It uses a "Bento" approach where modules span variable columns (e.g., 8-column main features paired with 4-column side highlights).

Vertical rhythm is defined by large section gaps (64px) to allow the high-vibrancy imagery to breathe. A dual-navigation strategy is employed: a top bar for utility and a bottom-docked navigation bar for core mobile-first actions.

## Elevation & Depth
Depth is created through three primary techniques:
1.  **Backdrop Blurs:** Navigation bars use an 80% opacity surface with a 20px blur (backdrop-blur-xl) to sit "above" the scrolling content.
2.  **Soft Layering:** Cards use a subtle `shadow-sm` and thin 1px borders (10% opacity) to define boundaries without heavy shadows.
3.  **Actionable Elevation:** Primary buttons and CTA sections use `shadow-xl` or `shadow-lg` to create a "floating" effect, indicating they are the most interactive elements on the page.

## Shapes
The design utilizes a high-radius shape language to reinforce the "friendly" and "safe" brand promise. Standard containers use 1rem (16px) rounding, while high-level sections like the Hero and Bento blocks use 2rem (32px). 

Buttons and badges are fully pill-shaped (rounded-full). This lack of sharp corners mirrors the "temperature-controlled, soft-edged" environment of the actual pet stay.

## Components

### Buttons
- **Primary:** Gradient background (Deep Sea to Cyan Sky), white text, pill-shaped, large padding (px-8 py-4), with a subtle scale-up transition on hover.
- **Secondary/Outline:** Surface-colored background with a light border, used for less urgent secondary actions like "View Pricing."

### Chips/Badges
- **Hero Badge:** Primary-container background with bold, uppercase text. Used for status indicators like "Premium Care."
- **Timeline Tags:** Small bold text in secondary or tertiary colors to mark time-slots.

### Bento Cards
- Standard containers with a 1px border at 10% opacity. Variations include "Primary Glow" (using background gradients) and "Tonal" (using subtle tertiary/secondary container tints).

### Navigation
- **Top Bar:** Translucent surface with a thin bottom shadow.
- **Floating Bottom Nav:** Highly rounded top corners (3rem), translucent background, with a "Primary Action" center button that is scaled up (110%) and features a vibrant gradient.

### Lists & Icons
- Icons use the "Material Symbols Outlined" set, often enclosed in a 12x12 rounded-xl container with a 10% primary tint for visual emphasis.