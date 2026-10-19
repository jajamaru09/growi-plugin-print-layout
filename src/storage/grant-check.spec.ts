import { describe, expect, test } from 'vitest';

import { hasSameGrant, isGrantWider } from './grant-check';

const g = (grant: number, ...groups: string[]) => ({ grant, grantedGroups: groups.map((id) => ({ type: 'UserGroup', id })) });

describe('isGrantWider', () => {
  test.each([
    ['(5,[g1]) -> (1)', g(5, 'g1'), g(1), true],
    ['(4) -> (2)', g(4), g(2), true],
    ['(5,[g1]) -> (2)', g(5, 'g1'), g(2), true],
    ['(4) -> (1)', g(4), g(1), true],
    ['(2) -> (1)', g(2), g(1), true],
    ['(5,[g1,g2]) -> (5,[g1])', g(5, 'g1', 'g2'), g(5, 'g1'), false],
    ['(5,[g1]) -> (5,[g1,g3])', g(5, 'g1'), g(5, 'g1', 'g3'), true],
    ['(1) -> (4)', g(1), g(4), false],
    ['(1) -> (1)', g(1), g(1), false],
    ['(2) -> (2)', g(2), g(2), false],
    ['(5,[g1]) -> (4)', g(5, 'g1'), g(4), false],
    ['(4) -> (5,[g1])', g(4), g(5, 'g1'), true],
    // The child's JSON holds sourcePageId, which is the link a link-only source hides.
    ['(2) -> (5,[g1])', g(2), g(5, 'g1'), true],
    ['(2) -> (4)', g(2), g(4), false],
    ['(4) -> (4)', g(4), g(4), false],
    ['(5,[g1]) -> (5,[g1])', g(5, 'g1'), g(5, 'g1'), false],
    ['(1) -> (2)', g(1), g(2), false],
    ['(1) -> (5,[g1])', g(1), g(5, 'g1'), false],
  ])('%s', (_label, source, child, expected) => {
    expect(isGrantWider(source, child)).toBe(expected);
  });
});

describe('hasSameGrant', () => {
  test.each([
    ['(1) / (1)', g(1), g(1), true],
    ['(2) / (2)', g(2), g(2), true],
    ['(4) / (4)', g(4), g(4), true],
    ['(5,[g1,g2]) / (5,[g2,g1])', g(5, 'g1', 'g2'), g(5, 'g2', 'g1'), true],
    ['(1) / (4)', g(1), g(4), false],
    ['(5,[g1]) / (1)', g(5, 'g1'), g(1), false],
    ['(5,[g1,g2]) / (5,[g1])', g(5, 'g1', 'g2'), g(5, 'g1'), false],
    ['(5,[g1]) / (5,[g1,g2])', g(5, 'g1'), g(5, 'g1', 'g2'), false],
  ])('%s', (_label, source, child, expected) => {
    expect(hasSameGrant(source, child)).toBe(expected);
  });
});
