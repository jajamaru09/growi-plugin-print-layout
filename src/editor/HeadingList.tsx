import type { HeadingInfo } from '../layout';
import { CLOSED_EYE_PATHS, OPEN_EYE_PATHS } from './eye-icons';

export interface HeadingListProps {
  headings: readonly HeadingInfo[];
  /** Block indexes of the headings the user hid. */
  hidden: ReadonlySet<number>;
  /** Heading hidden only by an enclosing hidden heading -> that outer heading's block index. */
  coveredBy: ReadonlyMap<number, number>;
  onToggle(headingBlockIndex: number, hide: boolean): void;
}

const INDENT_PX = 12;

const EyeIcon = ({ paths }: { paths: readonly string[] }) => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {paths.map((d) => (
      <path key={d} d={d} />
    ))}
  </svg>
);

export const HeadingList = ({ headings, hidden, coveredBy, onToggle }: HeadingListProps) => {
  if (headings.length === 0) return null;
  return (
    <section className="pl-section pl-headings">
      <p className="pl-headings-title">見出し</p>
      <ul>
        {headings.map((heading) => {
          const isHidden = hidden.has(heading.blockIndex);
          const isCovered = !isHidden && coveredBy.has(heading.blockIndex);
          const classes = [isHidden && 'pl-heading-hidden', isCovered && 'pl-heading-covered'].filter(Boolean).join(' ');
          return (
            <li
              key={heading.blockIndex}
              className={classes === '' ? undefined : classes}
              style={{ paddingLeft: `${(heading.level - 1) * INDENT_PX}px` }}
            >
              <button
                type="button"
                className="pl-heading-toggle"
                aria-label={`${isHidden ? '表示に戻す' : '印刷しない'}: ${heading.label}`}
                onClick={() => onToggle(heading.blockIndex, !isHidden)}
              >
                <EyeIcon paths={isHidden ? CLOSED_EYE_PATHS : OPEN_EYE_PATHS} />
              </button>
              <span className="pl-heading-label">{heading.label}</span>
              {isCovered && <span className="pl-heading-note">（上の見出しで非表示）</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
