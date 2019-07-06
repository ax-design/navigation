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

## Events

### Switch

**Bubbles:** No

**Cancelable:** No

**Interface:** SwitchEvent

**Description:** A `ax-navigation` element receives a switch event when the indicator switched from one item to another item.

**Properties:**

* **`SwitchEvent.detail.from`:** The highlighted element before user switched the tab;
* **`SwitchEvent.detail.to`:** The highlighted element after user switched the tab.
