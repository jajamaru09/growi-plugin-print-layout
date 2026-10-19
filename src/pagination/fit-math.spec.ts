import { describe, expect, test } from 'vitest';
import { decideFit, fitWarning, nextScale, wrapsFor } from './fit-math';

describe('decideFit', () => {
  test('auto wraps and shrinks what is still too wide, floored to 0.01', () => {
    expect(decideFit({ override: undefined, naturalPx: 600, availablePx: 400 })).toEqual({ wrap: true, scale: 0.66 });
  });

  test('auto leaves a block that fits at scale 1', () => {
    expect(decideFit({ override: undefined, naturalPx: 300, availablePx: 400 })).toEqual({ wrap: true, scale: 1 });
  });

  test('shrink does not wrap and scales the unwrapped width down', () => {
    expect(decideFit({ override: { mode: 'shrink' }, naturalPx: 1000, availablePx: 400 })).toEqual({
      wrap: false,
      scale: 0.4,
    });
  });

  test('scale wraps and uses the chosen percentage as is', () => {
    expect(decideFit({ override: { mode: 'scale', scalePercent: 80 }, naturalPx: 600, availablePx: 400 })).toEqual({
      wrap: true,
      scale: 0.8,
    });
  });

  test.each([
    [570, 1000, 0.57],
    [290, 1000, 0.29],
    [990, 1000, 0.99],
  ])('floors %d/%d without floating-point drift', (availablePx, naturalPx, scale) => {
    expect(decideFit({ override: undefined, naturalPx, availablePx }).scale).toBe(scale);
  });

  test('a block whose integer-rounded width exceeds a fractional container by under 1px fits at scale 1', () => {
    expect(decideFit({ override: undefined, naturalPx: 643, availablePx: 642.53125 }).scale).toBe(1);
    expect(decideFit({ override: { mode: 'shrink' }, naturalPx: 643, availablePx: 642.53125 }).scale).toBe(1);
  });

  test.each([
    [Number.NaN, 400],
    [600, Number.NaN],
    [0, 400],
    [600, 0],
    [-5, 400],
    [Number.POSITIVE_INFINITY, 400],
  ])('natural %d / available %d falls back to scale 1', (naturalPx, availablePx) => {
    expect(decideFit({ override: undefined, naturalPx, availablePx }).scale).toBe(1);
    expect(decideFit({ override: { mode: 'shrink' }, naturalPx, availablePx }).scale).toBe(1);
  });
});

describe('fitWarning', () => {
  test('shrink below the warning scale is flagged as small', () => {
    const input = { override: { mode: 'shrink' } as const, naturalPx: 1000, availablePx: 400 };
    expect(fitWarning(input, decideFit(input))).toBe('small');
  });

  test('auto below the warning scale is flagged as small, at or above it is not', () => {
    const small = { override: undefined, naturalPx: 1000, availablePx: 590 };
    const fine = { override: undefined, naturalPx: 1000, availablePx: 600 };
    expect(fitWarning(small, decideFit(small))).toBe('small');
    expect(fitWarning(fine, decideFit(fine))).toBeNull();
  });

  test('a fixed scale that still leaves the block too wide is flagged as overflow', () => {
    const input = { override: { mode: 'scale', scalePercent: 80 } as const, naturalPx: 600, availablePx: 400 };
    expect(fitWarning(input, decideFit(input))).toBe('overflow');
  });

  test('a fixed scale that makes the block fit has no warning, however small', () => {
    const fits = { override: { mode: 'scale', scalePercent: 80 } as const, naturalPx: 450, availablePx: 400 };
    const tiny = { override: { mode: 'scale', scalePercent: 50 } as const, naturalPx: 100, availablePx: 400 };
    expect(fitWarning(fits, decideFit(fits))).toBeNull();
    expect(fitWarning(tiny, decideFit(tiny))).toBeNull();
  });
});

describe('fitWarning for a block still too wide at its scale', () => {
  test.each([
    ['auto', undefined],
    ['shrink-only', { mode: 'shrink' } as const],
  ])('%s is flagged as overflow, even above the warning scale', (_label, override) => {
    expect(fitWarning({ override, naturalPx: 1000, availablePx: 643 }, { wrap: true, scale: 0.7 })).toBe('overflow');
  });

  test('auto within the rounding tolerance is not', () => {
    expect(fitWarning({ override: undefined, naturalPx: 1000, availablePx: 699.5 }, { wrap: true, scale: 0.7 })).toBeNull();
  });
});

describe('fitWarning at sub-pixel rounding', () => {
  test('a fixed 100% on a block that exceeds a fractional container by under 1px has no warning', () => {
    const input = { override: { mode: 'scale', scalePercent: 100 } as const, naturalPx: 643, availablePx: 642.4 };
    expect(fitWarning(input, decideFit(input))).toBeNull();
  });
});

describe('fitWarning without a measurable container', () => {
  test.each([0, Number.NaN, -1])('a measured block in a container of width %d is flagged as overflow', (availablePx) => {
    const input = { override: undefined, naturalPx: 600, availablePx };
    expect(fitWarning(input, decideFit(input))).toBe('overflow');
  });

  test('nothing measured at all is not flagged', () => {
    const input = { override: undefined, naturalPx: 0, availablePx: 0 };
    expect(fitWarning(input, decideFit(input))).toBeNull();
  });
});

describe('wrapsFor', () => {
  test('only shrink-only keeps lines unwrapped, and decideFit agrees', () => {
    const overrides = [undefined, { mode: 'shrink' } as const, { mode: 'scale', scalePercent: 70 } as const];
    expect(overrides.map(wrapsFor)).toEqual([true, false, true]);
    for (const override of overrides) {
      expect(decideFit({ override, naturalPx: 600, availablePx: 400 }).wrap).toBe(wrapsFor(override));
    }
  });
});

describe('nextScale', () => {
  test('a zoomed target that fits, within the rounding tolerance, keeps its scale', () => {
    expect(nextScale(0.52, 643, 643)).toBeNull();
    expect(nextScale(0.52, 643, 643.9)).toBeNull();
  });

  test('a zoomed target laid out wider than its container steps down by the overshoot', () => {
    expect(nextScale(0.52, 643, 700)).toBe(0.47);
  });

  test('steps down at least 0.01 even when the overshoot rounds away', () => {
    expect(nextScale(0.52, 643, 645.3)).toBe(0.51);
    expect(nextScale(0.57, 643, 645)).toBe(0.56);
  });

  test('never goes below 0.01', () => {
    expect(nextScale(0.01, 100, 500)).toBeNull();
    expect(nextScale(0.02, 1, 500)).toBe(0.01);
  });

  test.each([
    [Number.NaN, 400],
    [600, Number.NaN],
    [0, 400],
  ])('an unmeasurable width (available %d, rendered %d) keeps the scale', (availablePx, renderedPx) => {
    expect(nextScale(0.5, availablePx, renderedPx)).toBeNull();
  });
});
