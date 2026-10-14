// The indicator is drawn in a canonical bar space that does not depend on the direction of the
// navigation: u runs along the bar from the start of the item order, and v runs across it from
// the side that faces the content. The canvas box holds the shape's frame plus whatever an
// outward decoration needs on either side of it.

export type Direction = 'horizontal' | 'vertical';

// A box in viewport pixels, as getBoundingClientRect returns it.
export interface Box {
    left: number;
    top: number;
    width: number;
    height: number;
}

// An interval along the bar, relative to the origin of the canvas box.
export interface Along {
    start: number;
    size: number;
}

// A 2D matrix in the order CanvasRenderingContext2D.setTransform takes it.
export type Matrix = [number, number, number, number, number, number];

export function directionOf(element: Element): Direction {
    return element.hasAttribute('vertical') ? 'vertical' : 'horizontal';
}

// The extent of the box along the bar, relative to the canvas box.
export function along(box: Box, canvas: Box, direction: Direction): Along {
    return direction === 'vertical'
        ? { start: box.top - canvas.top, size: box.height }
        : { start: box.left - canvas.left, size: box.width };
}

// Maps canonical (u, v) to canvas device pixels. The bar itself occupies v in [0, thickness],
// so the canvas spans v in [-padInner, thickness + padOuter]: the pads are the canvas margins
// on the side toward the content and on the side away from it.
export function matrix(direction: Direction, thickness: number, padInner: number, padOuter: number, dpr: number): Matrix {
    // A vertical navigation puts the canvas in a strip to the left of the content, so the side
    // facing the content is the strip's right edge and v grows to the left.
    return direction === 'vertical'
        ? [0, dpr, -dpr, 0, (thickness + padOuter) * dpr, 0]
        : [dpr, 0, 0, dpr, 0, padInner * dpr];
}
