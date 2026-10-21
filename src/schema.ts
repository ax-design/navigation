import type { PropertySpec } from '@ax-design/typed-om';
import { SHAPE } from '@ax-design/surface/schema';

// The deformation of each end is a damped follower: it chases how much of that end's travel is
// left, with its own stiffness and damping. The general pair applies to both ends; an end uses
// its own value unless it is -1, which means "use the general one".
const deform = (name: string, initial: string): PropertySpec => ({
    name,
    syntax: { type: 'number' },
    initial,
    inherits: true,
    register: true,
});

// The shape of the indicator is the Axiom surface contract: --ax-radius, --ax-corner-* and
// --ax-edge-{top,right,bottom,left}-*. The general properties (--ax-edge-span and friends) come
// in through SHAPE.read too, and shapeSpecFrom's fallback passes a general value on to each side
// and corner that holds the auto sentinel. See the surface README for the names.
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
    deform('--navigation-indicator-deform-stiffness', '400'),
    deform('--navigation-indicator-deform-damping', '32'),
    deform('--navigation-indicator-lead-stiffness', '-1'),
    deform('--navigation-indicator-lead-damping', '-1'),
    deform('--navigation-indicator-trail-stiffness', '-1'),
    deform('--navigation-indicator-trail-damping', '-1'),
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
    // The deformation of each end, written while it is in flight and while it settles. Numbers
    // rather than an animation, because a feature shaped from them with calc() is drawn by the
    // browser in every engine: an animation of a custom property is applied in steps unless
    // CSS.registerProperty registered it.
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
