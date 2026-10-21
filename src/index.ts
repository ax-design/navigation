import { canRegister, registerProperties } from '@ax-design/typed-om';
import { AxNavigation, AxNavigationItem } from './CustomElements.js';
import { NAVIGATION_PROPERTIES, SPEED_PROPERTY, WINDOW_PROPERTIES } from './schema.js';

export { AxNavigation, AxNavigationItem } from './CustomElements.js';
export type { NavigationMode, SwitchReason } from './CustomElements.js';
export { NAVIGATION_PROPERTIES, SPEED_PROPERTY, WINDOW_PROPERTIES } from './schema.js';

let registered = false;

export function register(): void {
    if (registered) return;
    registered = true;

    if (canRegister()) {
        const registerProperty = (CSS as unknown as { registerProperty: (d: unknown) => void }).registerProperty.bind(CSS);
        for (const property of [SPEED_PROPERTY, ...WINDOW_PROPERTIES]) {
            try {
                registerProperty(property);
            } catch (error) {
                if (!error || (error as Error).name !== 'InvalidModificationError') throw error;
            }
        }
    }
    // The general shape properties (--ax-edge-span and friends) come in through SHAPE.read,
    // which NAVIGATION_PROPERTIES spreads, and shapeSpecFrom falls back to a general value for
    // each side and corner that holds the auto sentinel.
    registerProperties(NAVIGATION_PROPERTIES);

    if (!customElements.get(AxNavigation.ElementName)) {
        customElements.define(AxNavigation.ElementName, AxNavigation);
    }
    if (!customElements.get(AxNavigationItem.ElementName)) {
        customElements.define(AxNavigationItem.ElementName, AxNavigationItem);
    }
}
