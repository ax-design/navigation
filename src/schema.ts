import type { PropertySpec } from '@ax-design/typed-om';

export const NAVIGATION_PROPERTIES: PropertySpec[] = [
    {
        name: '--navigation-indicator-color',
        syntax: { type: 'color' },
        initial: 'rgb(0, 0, 0)',
        inherits: true,
        register: true,
    },
    {
        name: '--navigation-indicator-width',
        syntax: { type: 'length' },
        initial: '2px',
        inherits: true,
        register: true,
    },
    {
        name: '--navigation-private-indicator-width',
        syntax: { type: 'length-percentage' },
        initial: '0px',
        inherits: true,
        register: true,
    },
    {
        name: '--navigation-private-indicator-height',
        syntax: { type: 'length-percentage' },
        initial: '0px',
        inherits: true,
        register: true,
    },
    {
        name: '--navigation-private-indicator-left',
        syntax: { type: 'length-percentage' },
        initial: '0px',
        inherits: true,
        register: true,
    },
    {
        name: '--navigation-private-indicator-bottom',
        syntax: { type: 'length-percentage' },
        initial: '0px',
        inherits: true,
        register: true,
    },
];

export const SPEED_PROPERTY = {
    name: '--navigation-indicator-speed',
    syntax: '<time>',
    initialValue: '600ms',
    inherits: true,
};
