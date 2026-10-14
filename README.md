<h1 align="center">
  <img src="https://raw.githubusercontent.com/ax-design/navigation/master/docs/logo.png" alt="navigation">
</h1>

<p align="center">
  Web component that implement Navigation Indicator animation of Axiom Design System.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@ax-design/navigation"><img src="https://img.shields.io/npm/v/@ax-design/navigation.svg" alt="npm version"></a>
  <a href="https://travis-ci.com/ax-design/navigation"><img src="https://travis-ci.com/ax-design/navigation.svg?branch=master" alt="CI Status"></a>
  <a href="https://deepscan.io/dashboard#view=project&tid=4412&pid=6183&bid=50118"><img src="https://deepscan.io/api/teams/4412/projects/6183/branches/50118/badge/grade.svg" alt="DeepScan grade"></a>
  <a href="https://t.me/axiom_chat"><img src="https://img.shields.io/badge/chat-on%20Telegram-%230088cc.svg" alt="Telegram chat group" /></a>
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="MIT Licence" />
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/ax-design/navigation/master/docs/screen-record.gif" alt="Screenshot">
</p>

## Installation

```bash
// with npm
npm install @ax-design/navigation

// with yarn
yarn add @ax-design/navigation
```

and import it:

```javascript
//CommonJS
require('@ax-design/navigation').register();

//ESModule
import { register } from '@ax-design/navigation';
register();
```

## Usage

### Horizontal Navigation

```html
<ax-navigation>
  <ax-navigation-item>Home</ax-navigation-item>
  <ax-navigation-item>Apps</ax-navigation-item>
  <ax-navigation-item>Games</ax-navigation-item>
</ax-navigation>
```

### Vertical Navigation

```html
<ax-navigation vertical>
  <ax-navigation-item>Home</ax-navigation-item>
  <ax-navigation-item>Apps</ax-navigation-item>
  <ax-navigation-item>Games</ax-navigation-item>
</ax-navigation>
```

## Style Controlling

Navigation component uses custom properties to manage the style of the navigation indicator.

### --navigation-indicator-speed

**Type:** `<time>`

**Default:** `600ms`

**Description:** The speed of navigation indicator's animation.

### --navigation-indicator-color

**Type:** `<color>`

**Default:** `black`

**Description:** The color of navigation indicator.

### --navigation-indicator-width

**Type:** `<length>`

**Default:** `2px`

**Description:** The width of navigation indicator.

### Shape

The indicator is a shape of [@ax-design/surface](https://github.com/ax-design/surface), styled
with that contract: `--ax-radius`, `--ax-corner-shape`,
`--ax-corner-{corner}-{radius,shape,shift-x,shift-y,shoulder-radius}` and
`--ax-edge-{side}-{kind,depth,span,at,ratio,tip-radius,shoulder-radius}`, where `{corner}` is one
of `top-left`, `top-right`, `bottom-right`, `bottom-left` and `{side}` is one of `top`, `right`,
`bottom`, `left`. The general forms (`--ax-edge-kind` and friends) set every side at once. With
none of them set the indicator is a plain rectangle.

```css
ax-navigation {
  --navigation-indicator-width: 12px;
  --ax-radius: 4px;
  --ax-corner-top-left-shape: bevel;
  --ax-corner-bottom-right-shift-x: 8px; /* a parallelogram */
}
```

The shape is drawn into the bar the current item occupies: `--navigation-indicator-width`
across the bar, the item's length along it. Both directions share that frame, so in a
`vertical` navigation `top` and `bottom` are still the two long sides, `top` facing the
content, and `right` and `left` are still the end the indicator moves toward and the end it
starts from. `--ax-edge-{side}-at` is proportional along its side, so a decoration cannot be
pinned a fixed distance from the end of the bar.

The border and tilt properties of surface are not read. The resting indicator is drawn on the
same canvas as the moving one, so the two always agree. The layout keeps free the space an
outward feature takes on the side away from the content; on the side facing the content it draws
over the items.

### Moving

While the indicator is moving from one item to another the element carries the `moving`
attribute, with `forward` or `backward` as its value: forward is toward the end of the item
order, which is right in a horizontal navigation and down in a vertical one. The attribute goes
away when the indicator arrives, and an interrupted movement starts it over.

The element also writes what each part of a movement is doing:

* `--navigation-indicator-arrival` and `--navigation-indicator-follow` are the times the leading
  end takes to reach the item and the trailing end takes to follow it.
* `--navigation-indicator-lead` and `--navigation-indicator-trail` are the deformation of those
  ends. Each is driven by a spring of its own, released when that end has practically finished
  its travel, so a feature shaped from it grows while its part of the movement runs and settles
  again after it.

The general `--navigation-indicator-deform-stiffness` and `--navigation-indicator-deform-damping`
set how hard both springs follow; `--navigation-indicator-{lead,trail}-stiffness` and
`-damping` override them for one end. A larger stiffness makes an end answer sooner, a larger
damping makes it settle without overshooting.

A feature is shaped from a deformation with `calc()`. The shape is read every frame, which also
keeps it working where `CSS.registerProperty` is missing: there an animation of a custom
property is applied in steps instead of interpolating.

```css
ax-navigation {
  --ax-edge-right-kind: triangle;
  --ax-edge-right-span: 100%;
  --ax-edge-left-kind: triangle;
  --ax-edge-left-span: 100%;
  --navigation-indicator-deform-stiffness: 400;
  --navigation-indicator-deform-damping: 32;
  --navigation-indicator-trail-stiffness: 900;
  --navigation-indicator-trail-damping: 46;
  --ax-edge-right-depth: calc(var(--navigation-indicator-lead, 0) * 9px);
  --ax-edge-left-depth: calc(var(--navigation-indicator-trail, 0) * -7px);
}

ax-navigation[moving="backward"] {
  --ax-edge-right-depth: calc(var(--navigation-indicator-trail, 0) * -7px);
  --ax-edge-left-depth: calc(var(--navigation-indicator-lead, 0) * 9px);
}
```

## Events

### Switch

**Bubbles:** No

**Cancelable:** No

**Interface:** SwitchEvent

**Description:** A `ax-navigation` element receives a switch event when the indicator switched from one item to another item.

**Properties:**

* **`SwitchEvent.detail.from`:** The highlighted element before user switched the tab;
* **`SwitchEvent.detail.to`:** The highlighted element after user switched the tab.
