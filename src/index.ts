import { canRegister, registerProperties } from '@ax-design/typed-om';
import { SHAPE } from '@ax-design/surface/schema';
import { AxNavigation, AxNavigationItem } from './CustomElements.js';
import { NAVIGATION_PROPERTIES, SPEED_PROPERTY } from './schema.js';

export { AxNavigation, AxNavigationItem } from './CustomElements.js';
export { NAVIGATION_PROPERTIES, SPEED_PROPERTY } from './schema.js';

let registered = false;

export function register(): void {
    if (registered) return;
    registered = true;

    if (canRegister()) {
        try {
            (CSS as unknown as { registerProperty: (d: unknown) => void }).registerProperty(SPEED_PROPERTY);
        } catch (error) {
            if (!error || (error as Error).name !== 'InvalidModificationError') throw error;
        }
    }
    // The general shape properties (--ax-edge-span and friends) are registered apart from the
    // ones the reader watches, the way surface does it: the shadow root's fallback CSS passes
    // the general value on to each side and corner.
    registerProperties(SHAPE.shared || []);
    registerProperties(NAVIGATION_PROPERTIES);

    if (!customElements.get(AxNavigation.ElementName)) {
        customElements.define(AxNavigation.ElementName, AxNavigation);
    }
    if (!customElements.get(AxNavigationItem.ElementName)) {
        customElements.define(AxNavigationItem.ElementName, AxNavigationItem);
    }
}
