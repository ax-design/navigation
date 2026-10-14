import type { PropertySpec } from '@ax-design/typed-om';
import { SHAPE } from '@ax-design/surface/schema';

// The shape of the indicator is the Axiom surface contract: --ax-radius, --ax-corner-* and
// --ax-edge-{top,right,bottom,left}-*. The general properties (--ax-edge-span and friends) are
// not read here; they are registered from SHAPE.shared and reach every side through
// SHAPE.fallbackCss, which the shadow root includes. See the surface README for the names.
export const NAVIGATION_PROPERTIES: PropertySpec[] = [
    ...SHAPE.read,
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
];

// Written by the component, never authored, and left unregistered on purpose: an unregistered
// custom property inherits into the shadow root, and the change detector does not watch a value
// the component writes itself.
export const PAD_INNER = '--navigation-private-indicator-pad-inner';
export const PAD_OUTER = '--navigation-private-indicator-pad-outer';

export const SPEED_PROPERTY = {
    name: '--navigation-indicator-speed',
    syntax: '<time>',
    initialValue: '600ms',
    inherits: true,
};

// A movement is two parts: the leading end takes the first to reach the item and the trailing
// end the second to follow it. The component writes them, so a style can give an animation the
// length of the part whose end carries its feature. Registered apart from NAVIGATION_PROPERTIES:
// they are written here, not read, and the change detector does not watch them.
export const ARRIVAL_PROPERTY = '--navigation-indicator-arrival';
export const FOLLOW_PROPERTY = '--navigation-indicator-follow';
export const LEAD_PROPERTY = '--navigation-indicator-lead';
export const TRAIL_PROPERTY = '--navigation-indicator-trail';

export const WINDOW_PROPERTIES = [
    {
        name: ARRIVAL_PROPERTY,
        syntax: '<time>',
        initialValue: '0ms',
        inherits: true,
    },
    {
        name: FOLLOW_PROPERTY,
        syntax: '<time>',
        initialValue: '0ms',
        inherits: true,
    },
    // How far each end is deformed while it travels: 0 while it stands, 1 at the middle of its
    // travel, 0 when it arrives. Numbers rather than an animation, because a feature shaped from
    // them with calc() is drawn by the browser in every engine: an animation of a custom property
    // is applied in steps unless CSS.registerProperty registered it.
    {
        name: LEAD_PROPERTY,
        syntax: '<number>',
        initialValue: '0',
        inherits: true,
    },
    {
        name: TRAIL_PROPERTY,
        syntax: '<number>',
        initialValue: '0',
        inherits: true,
    },
];
