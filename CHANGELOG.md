# Changelog

All notable changes to this package are documented in this file.

## 0.1.0

- Keyboard: the arrow keys, Home and End move between the items, Tab enters the current tab, and Enter on a link counts as the keyboard. Items get their roles, and `select()` switches from code; `SwitchEvent.detail.reason` tells how it switched.
- The indicator moves at once under reduced motion, and is painted with `Highlight` in forced colors.
- Built on Surface 0.3.
