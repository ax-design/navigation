import { describe, expect, test } from 'bun:test';
import { resolve } from '@ax-design/shape';
import { SHAPE, Values, shapeSpecFrom } from '@ax-design/surface/schema';
import type { PropertySpec, PropertyValue } from '@ax-design/typed-om';
import { along, directionOf, matrix } from '../src/bar.js';
import { NAVIGATION_PROPERTIES } from '../src/schema.js';

// The value the reader reports for a property nobody set, in the shape Values expects.
function initialValue(spec: PropertySpec): PropertyValue {
    const syntax = spec.syntax;
    if (syntax.type === 'length-percentage') {
        return spec.initial.endsWith('%')
            ? { px: 0, percent: parseFloat(spec.initial) }
            : { px: parseFloat(spec.initial) || 0, percent: 0 };
    }
    if (syntax.type === 'length' || syntax.type === 'number') return parseFloat(spec.initial) || 0;
    if (syntax.type === 'color') return [0, 0, 0, 1];
    return spec.initial;
}

function valuesWith(overrides: Record<string, PropertyValue>): Values {
    const values = new Values(NAVIGATION_PROPERTIES);
    values.values = NAVIGATION_PROPERTIES.map((spec) =>
        Object.prototype.hasOwnProperty.call(overrides, spec.name) ? overrides[spec.name] : initialValue(spec)
    );
    return values;
}

const px = (n: number) => ({ px: n, percent: 0 });

describe('canonical bar space', () => {
    test('measures along the bar in both directions', () => {
        const canvas = { left: 10, top: 20, width: 200, height: 8 };
        const item = { left: 40, top: 60, width: 30, height: 100 };
        expect(along(item, canvas, 'horizontal')).toEqual({ start: 30, size: 30 });
        expect(along(item, canvas, 'vertical')).toEqual({ start: 40, size: 100 });
    });

    test('maps canonical points to device pixels', () => {
        // Horizontal: u is x and v is y, so the bar starts padInner below the canvas top.
        expect(matrix('horizontal', 8, 4, 2, 2)).toEqual([2, 0, 0, 2, 0, 8]);
        // Vertical: the canvas is a strip left of the content, so u is y, the side facing the
        // content is the strip's right edge, and v grows to the left.
        expect(matrix('vertical', 8, 4, 2, 2)).toEqual([0, 2, -2, 0, 20, 0]);
    });

    test('reads the direction from the attribute', () => {
        const horizontal = { hasAttribute: () => false } as unknown as Element;
        const vertical = { hasAttribute: (name: string) => name === 'vertical' } as unknown as Element;
        expect(directionOf(horizontal)).toBe('horizontal');
        expect(directionOf(vertical)).toBe('vertical');
    });
});

describe('the ax contract drives the shape', () => {
    test('with nothing set the indicator is the plain rectangle of the bar', () => {
        const shape = resolve(shapeSpecFrom(valuesWith({}), 120, 8));
        expect(shape.clamps).toEqual([]);
        expect(shape.bounds).toEqual({ left: 0, top: 0, right: 120, bottom: 8 });
        expect(shape.outline.segments.length).toBe(4);
        for (const segment of shape.outline.segments) expect(segment.type).toBe('line');
    });

    test('rounded and cut corners, a lean and an arc all reach the shape', () => {
        const values = valuesWith({
            '--ax-radius': px(4),
            '--ax-corner-top-left-shape': 'bevel',
            '--ax-corner-bottom-right-shift-x': px(10),
            '--ax-edge-top-kind': 'arc',
            '--ax-edge-top-depth': -3,
            '--ax-edge-top-span': px(24),
        });
        const shape = resolve(shapeSpecFrom(values, 160, 32));
        expect(shape.clamps).toEqual([]);
        // A lean moves the bottom right corner into the shape, so the outline loses width but
        // no dimension leaves the frame.
        const epsilon = 1e-9;
        expect(shape.bounds.left).toBeGreaterThan(-epsilon);
        expect(shape.bounds.right).toBeLessThan(160 + epsilon);
        expect(shape.bounds.top).toBeGreaterThan(-epsilon);
        expect(shape.bounds.bottom).toBeLessThan(32 + epsilon);
        // The top side carries an arc plus the corner outlines, so there is more than a box.
        expect(shape.outline.segments.some((segment) => segment.type === 'arc')).toBe(true);
        expect(shape.outline.segments.length).toBeGreaterThan(4);
    });

    test('the fallback css passes a general property on to each side', () => {
        const css = SHAPE.fallbackCss || '';
        expect(css).toContain('--ax-edge-top-kind: var(--ax-edge-kind)');
        expect(css).toContain('--ax-edge-bottom-span: var(--ax-edge-span)');
        expect(css).toContain('--ax-corner-top-left-shoulder-radius: var(--ax-corner-shoulder-radius)');
        expect((SHAPE.shared || []).some((spec) => spec.name === '--ax-edge-span')).toBe(true);
    });
});

describe('the merged schema', () => {
    test('holds every shape property exactly once', () => {
        const names = NAVIGATION_PROPERTIES.map((spec) => spec.name);
        expect(new Set(names).size).toBe(names.length);
        expect(names).toContain('--ax-radius');
        expect(names).toContain('--ax-edge-left-depth');
        expect(names).toContain('--navigation-indicator-color');
        expect(names).toContain('--navigation-indicator-width');
        // Border and tilt belong to surface, not to the indicator.
        expect(names).not.toContain('--ax-border-width');
        expect(names).not.toContain('--ax-tilt-mode');
    });
});
