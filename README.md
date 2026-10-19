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

## Keyboard and screen readers

An `ax-navigation` gives its items the roles and states that a navigation or a tab list has, and
it handles the keys that go with them. Which of the three it uses is set by the `mode` attribute:

* **`links`**: some item holds a link (`a[href]`). The host is a `navigation`, the items are list
  items, and the link of the current item has `aria-current="page"`. No keys are added: Tab moves
  between the links and Enter follows one.
* **`tabs`**: nothing in an item can take focus. The host is a `tablist` with an
  `aria-orientation`, and the items are `tab`s with `aria-selected`. Only one item is in the Tab
  order, and the arrow keys move between the items (see the keys below).
* **`none`**: some item holds controls of its own, such as a button. The items keep their own
  semantics and get no keys. The element logs a warning once, which suggests setting `mode`.

Without a `mode` attribute, the mode is detected from the items: `links` if an item has a link,
else `none` if an item holds a control, else `tabs`. It is detected again whenever the items
change. Setting `mode` to `links`, `tabs` or `none` chooses it; any other value detects it. The
mode in use is read from the `effectiveMode` property.

Links example. The label names the `navigation` landmark, so a page with several can tell them apart:

```html
<ax-navigation aria-label="Site sections">
  <ax-navigation-item default><a href="/">Home</a></ax-navigation-item>
  <ax-navigation-item><a href="/apps">Apps</a></ax-navigation-item>
</ax-navigation>
```

Tabs example. Panels are not managed by the element: the author points each item at its panel with
`aria-controls`, and shows the panel in a `switch` listener:

```html
<ax-navigation aria-label="Settings" id="settings">
  <ax-navigation-item id="tab-general" aria-controls="panel-general">General</ax-navigation-item>
  <ax-navigation-item id="tab-privacy" aria-controls="panel-privacy">Privacy</ax-navigation-item>
</ax-navigation>
<div id="panel-general" role="tabpanel" aria-labelledby="tab-general">...</div>
<div id="panel-privacy" role="tabpanel" aria-labelledby="tab-privacy" hidden>...</div>
<script>
  document.getElementById('settings').addEventListener('switch', (e) => {
    document.getElementById('panel-general').hidden = e.detail.to.id !== 'tab-general';
    document.getElementById('panel-privacy').hidden = e.detail.to.id !== 'tab-privacy';
  });
</script>
```

Keys in `tabs` mode. The keys are handled only when the focus is on an item of this navigation,
and they are ignored with Alt, Ctrl or Meta held.

| Key | Action |
| --- | --- |
| Tab, Shift+Tab | Enter the navigation on the current item; leave it from wherever the arrows moved focus. |
| ArrowRight, ArrowLeft | In a horizontal navigation, move focus to the next or previous enabled item. Swapped when the element is right to left. |
| ArrowDown, ArrowUp | The same in a vertical navigation. |
| Home, End | Move focus to the first or last enabled item. |
| Enter, Space | Select the focused item. |

The end of the list is not wrapped: an arrow at the last item does nothing. The arrows, Home and
End only move focus. Space does not scroll the page while the navigation has the focus.

Moving focus does not select, unless the navigation has the boolean `selection-follows-focus`
attribute: then the arrows, Home and End select the item they move to.

An item with the boolean `disabled` attribute is skipped by the keys and ignores clicks. In `tabs`
mode it is `aria-disabled`, and out of the Tab order.

The `current` attribute is written on the current item in every mode, for styling it
(`ax-navigation-item[current]`). Setting it yourself does not select the item; the initial
selection still comes from `default`.

Selection from code:

```js
const nav = document.querySelector('ax-navigation');
nav.select(nav.querySelectorAll('ax-navigation-item')[2], { focus: true }); // true if it changed
nav.currentItem = item; // the same as select(item)
```

`select()` returns `false`, and does nothing, when the item is disabled, is already current, or is
not an item of this navigation. With `focus: true` it moves focus to the item, or to its link in
`links` mode.

The component writes its roles and states as attributes, and never over an attribute the author
has set: if an author attribute is there, or the author has changed one the component wrote, the
author's value is kept, and the component stops writing it.

### Changes

* Plain text items are now focusable tabs, with the keys above. Before, items reacted only to
  clicks. Use `mode="none"` for the old behaviour.
* The `nav` landmark inside the shadow root is gone. It is a `div` with the items in it, which is
  a `list` only in `links` mode, where the host is the `navigation` landmark.

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

In forced colors mode (`forced-colors: active`) the indicator is painted with the system `Highlight`
color instead, as in WinUI's High Contrast theme, and this property is not used.

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

With `prefers-reduced-motion: reduce` there is no movement: a switch draws the indicator on the new
item at once, as WinUI does with animations off, so the element never carries `moving`.

The element also writes what each part of a movement is doing:

* `--navigation-indicator-arrival` and `--navigation-indicator-follow` are the times the leading
  end takes to reach the item and the trailing end takes to follow it.
* `--navigation-indicator-lead` and `--navigation-indicator-trail` are the deformation of those
  ends. Each is driven by a spring of its own: the leading end while it still has travel to do,
  and the trailing end while the leading end is more than half deformed, so the two overlap
  instead of waiting for the tail to start moving.

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
* **`SwitchEvent.detail.to`:** The highlighted element after user switched the tab;
* **`SwitchEvent.detail.reason`:** Why it switched: `'pointer'` for a click, `'keyboard'` for the
  keys (Enter on a link included), or `'api'` for `select()` and the `currentItem` setter.
