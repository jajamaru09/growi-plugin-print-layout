import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { HeadingInfo } from '../layout';
import { HeadingList } from './HeadingList';

const heading = (blockIndex: number, level: number, label: string): HeadingInfo => ({
  blockIndex,
  level,
  label,
  anchor: { tag: `H${level}`, textHash: label, parents: [], occurrence: 0 },
});

const headings = [heading(0, 2, '概要'), heading(2, 3, '詳細'), heading(4, 2, '付録')];

afterEach(cleanup);

describe('HeadingList', () => {
  test('renders nothing when the page has no headings', () => {
    const { container } = render(<HeadingList headings={[]} hidden={new Set()} coveredBy={new Map()} onToggle={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  test('shows a titled section with one row per heading, indented by level', () => {
    render(<HeadingList headings={headings} hidden={new Set()} coveredBy={new Map()} onToggle={vi.fn()} />);
    expect(screen.getByText('見出し')).toBeTruthy();
    const rows = document.querySelectorAll('li');
    expect(rows).toHaveLength(3);
    const indent = (i: number) => Number.parseFloat((rows[i] as HTMLElement).style.paddingLeft);
    expect(indent(1)).toBeGreaterThan(indent(0));
    expect(indent(2)).toBe(indent(0));
  });

  test('a visible heading offers to hide it', () => {
    const onToggle = vi.fn();
    render(<HeadingList headings={headings} hidden={new Set()} coveredBy={new Map()} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: '印刷しない: 詳細' }));
    expect(onToggle).toHaveBeenCalledWith(2, true);
  });

  test('a heading the user hid is marked and offers to show it again', () => {
    const onToggle = vi.fn();
    render(<HeadingList headings={headings} hidden={new Set([0])} coveredBy={new Map()} onToggle={onToggle} />);
    expect(document.querySelectorAll('li.pl-heading-hidden')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '表示に戻す: 概要' }));
    expect(onToggle).toHaveBeenCalledWith(0, false);
  });

  test('a heading hidden only by an outer one is grayed with a note and can still be toggled', () => {
    const onToggle = vi.fn();
    render(<HeadingList headings={headings} hidden={new Set([0])} coveredBy={new Map([[2, 0]])} onToggle={onToggle} />);
    expect(screen.getByText('（上の見出しで非表示）')).toBeTruthy();
    expect(document.querySelectorAll('li.pl-heading-covered')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '印刷しない: 詳細' }));
    expect(onToggle).toHaveBeenCalledWith(2, true);
  });

  test('a label is rendered as text, never as HTML', () => {
    render(
      <HeadingList
        headings={[heading(0, 1, '<img src=x onerror=alert(1)>')]}
        hidden={new Set()}
        coveredBy={new Map()}
        onToggle={vi.fn()}
      />,
    );
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  });
});
