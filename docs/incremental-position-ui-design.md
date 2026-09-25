# Incremental Position UI Design

## Problem
Currently, incremental start values for positions use numeric sliders with limited ranges. For a 400×400 artboard, users need at least -200 to +200 range to position shapes at edges, but this range needs to scale with different artboard sizes.

## Proposed Solution: Predefined Anchor + Offset

### Why Predefined Anchors Are Better

1. **Intuitive** - Users think "I want shapes to start at the top-left" not "I want shapes to start at X=-200, Y=-200"
2. **Discoverable** - You can see the available positions in a dropdown instead of guessing numbers
3. **Consistent** - It matches your existing alignment system (the align mode in transforms)
4. **Edge cases covered** - The offset slider/input handles fine-tuning when needed

### Suggested UI

```
X Position Start:
  Anchor: [Dropdown: Left | Center | Right]
  Offset: [Slider + Input: -100 to 100]

Y Position Start:  
  Anchor: [Dropdown: Top | Center | Bottom]
  Offset: [Slider + Input: -100 to 100]
```

### Usage Examples

- **Top-left corner** = Top + Left with 0 offset
- **Slightly below top-left** = Top + Left with Y offset +20
- **Full flexibility** without mental math

### Benefits

- Works with any artboard size (anchors are relative to artboard bounds)
- More discoverable than numeric ranges
- Consistent with existing alignment UI patterns
- Allows precise fine-tuning via offset controls
