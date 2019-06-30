import { AxNavigation, AxNavigationItem } from './CustomElements.js';
export function register() {
    if (window.CSS && CSS.registerProperty) {
        customElements.define(AxNavigation.ElementName, AxNavigation);
        customElements.define(AxNavigationItem.ElementName, AxNavigationItem);
        CSS.registerProperty({
            name: '--navigation-indicator-speed',
            syntax: '<time>',
            initialValue: '600ms',
            inherits: true
        });
        CSS.registerProperty({
            name: '--navigation-indicator-color',
            syntax: '<color>',
            initialValue: 'black',
            inherits: true
        });
        CSS.registerProperty({
            name: '--navigation-indicator-width',
            syntax: '<length>',
            initialValue: '2px',
            inherits: true
        });
        CSS.registerProperty({
            name: '--navigation-private-indicator-width',
            syntax: '<length-percentage>',
            initialValue: '0',
            inherits: true
        });
        CSS.registerProperty({
            name: '--navigation-private-indicator-height',
            syntax: '<length-percentage>',
            initialValue: '0',
            inherits: true
        });
        CSS.registerProperty({
            name: '--navigation-private-indicator-left',
            syntax: '<length-percentage>',
            initialValue: '0',
            inherits: true
        });
        CSS.registerProperty({
            name: '--navigation-private-indicator-bottom',
            syntax: '<length-percentage>',
            initialValue: '0',
            inherits: true
        });
    } else {
        console.warn('Your browser do NOT support `CSS.registerProperty` method, register failed!');
    }

}