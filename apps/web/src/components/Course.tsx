import { type Lesson, type LessonBlock, course, getLevel, lessons } from '@cloud-architect/content';
import { useEffect, useRef, useState } from 'react';
import { catalogue } from '../lib/catalogue';
import { SANDBOX_ID } from '../lib/sandbox';
import { useGame } from '../store/gameStore';
import { Glyph } from './Glyph';
import { IconBack, IconBook, IconCheck } from './icons';

/** The beginner course: an outline on the left, one lesson to read on the right. */
export function Course() {
  const lessonId = useGame((s) => s.lessonId);
  const completed = useGame((s) => s.completedLessons);
  const openCourse = useGame((s) => s.openCourse);
  const complete = useGame((s) => s.completeLesson);
  const backToMenu = useGame((s) => s.backToMenu);
  const openLevel = useGame((s) => s.openLevel);
  const openSandbox = useGame((s) => s.openSandbox);
  const openGuide = useGame((s) => s.openGuide);
  const returnLevelId = useGame((s) => s.returnLevelId);
  const article = useRef<HTMLElement>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);

  const index = Math.max(
    0,
    lessons.findIndex((l) => l.id === lessonId),
  );
  const lesson = lessons[index]!;
  const mod = course.find((m) => m.lessons.some((l) => l.id === lesson.id))!;
  const next = lessons[index + 1];
  const prev = lessons[index - 1];
  const done = completed.includes(lesson.id);

  useEffect(() => {
    window.scrollTo(0, 0);
    article.current?.focus({ preventScroll: true });
    setOutlineOpen(false);
  }, [lessonId]);

  const back = () => {
    if (returnLevelId === SANDBOX_ID) openSandbox();
    else if (returnLevelId) openLevel(returnLevelId);
    else backToMenu();
  };
  const returnLevel = returnLevelId && returnLevelId !== SANDBOX_ID ? getLevel(returnLevelId) : undefined;

  return (
    <div className="course">
      <header className="course-bar">
        <button className="btn ghost" onClick={back}>
          <IconBack />
          {returnLevel
            ? `Back to ${returnLevel.title.replace(/^Boss: /, '')}`
            : returnLevelId
              ? 'Back to the sandbox'
              : 'Levels'}
        </button>
        <span className="course-progress">
          {completed.length} of {lessons.length}
          <span className="hide-sm"> lessons done</span>
          <span className="progress-track" aria-hidden>
            <span style={{ width: `${(completed.length / lessons.length) * 100}%` }} />
          </span>
        </span>
        <button
          className="btn ghost outline-toggle"
          onClick={() => setOutlineOpen((v) => !v)}
          aria-expanded={outlineOpen}
        >
          Outline
        </button>
        <button className="btn ghost" onClick={() => openGuide()}>
          <IconBook />
          <span className="hide-sm">Guide</span>
        </button>
      </header>

      <div className="course-body">
        <nav className={`course-outline${outlineOpen ? ' open' : ''}`} aria-label="Course outline">
          {course.map((m, mi) => (
            <section key={m.id}>
              <h2>
                <span className="module-num">Module {mi + 1}</span>
                {m.title}
              </h2>
              <ol>
                {m.lessons.map((l) => (
                  <li key={l.id}>
                    <button
                      className={`outline-item${l.id === lesson.id ? ' current' : ''}${completed.includes(l.id) ? ' done' : ''}`}
                      onClick={() => openCourse(l.id)}
                      aria-current={l.id === lesson.id ? 'page' : undefined}
                    >
                      <span
                        className="outline-mark"
                        aria-label={completed.includes(l.id) ? 'Done' : undefined}
                      >
                        {completed.includes(l.id) && <IconCheck />}
                      </span>
                      <span>{l.title}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </nav>

        <main className="lesson" ref={article} tabIndex={-1}>
          <p className="lesson-module">
            {mod.title}, lesson {mod.lessons.findIndex((l) => l.id === lesson.id) + 1} of {mod.lessons.length}
          </p>
          <h1>{lesson.title}</h1>
          <p className="lesson-summary">
            {lesson.summary} <span className="lesson-time">About {lesson.minutes} minutes.</span>
          </p>

          {lesson.blocks.map((b, i) => (
            <Block key={`${lesson.id}-${i}`} block={b} />
          ))}

          <Practice lesson={lesson} />

          <footer className="lesson-nav">
            {prev ? (
              <button className="btn ghost" onClick={() => openCourse(prev.id)}>
                Previous: {prev.title}
              </button>
            ) : (
              <span />
            )}
            {next ? (
              <button
                className="btn primary"
                onClick={() => {
                  complete(lesson.id);
                  openCourse(next.id);
                }}
              >
                {done ? 'Next' : 'Done'}: {next.title}
              </button>
            ) : (
              <button
                className="btn primary"
                onClick={() => {
                  complete(lesson.id);
                  backToMenu();
                }}
              >
                Finish the course
              </button>
            )}
          </footer>
        </main>
      </div>
    </div>
  );
}

function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text.split('\n\n').map((p) => (
        <p key={p.slice(0, 32)}>{p}</p>
      ))}
    </>
  );
}

function Block({ block }: { block: LessonBlock }) {
  switch (block.type) {
    case 'everyday':
      return (
        <section className="b-everyday">
          <h2>In everyday life: {block.title.charAt(0).toLowerCase() + block.title.slice(1)}</h2>
          <Paragraphs text={block.text} />
        </section>
      );
    case 'text':
      return (
        <section className="b-text">
          {block.title && <h2>{block.title}</h2>}
          <Paragraphs text={block.text} />
        </section>
      );
    case 'diagram':
      return (
        <figure className="b-diagram">
          <ol className="flow">
            {block.nodes.map((n, i) => (
              <li key={`${n.label}-${i}`}>
                {n.kind ? <Glyph kind={n.kind} /> : <span className="flow-plain" aria-hidden />}
                <span className="flow-text">
                  <b>{n.label}</b>
                  {n.note && <small>{n.note}</small>}
                </span>
              </li>
            ))}
          </ol>
          <figcaption>{block.caption}</figcaption>
        </figure>
      );
    case 'example':
      return (
        <section className="b-example">
          <h2>Worked example: {block.title.charAt(0).toLowerCase() + block.title.slice(1)}</h2>
          <Paragraphs text={block.text} />
        </section>
      );
    case 'compare':
      return (
        <section className="b-compare">
          <h2>{block.title}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{block.rowHeader ?? ''}</th>
                  {block.columns.map((c) => (
                    <th key={c} scope="col">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((r) => (
                  <tr key={r.label}>
                    <th scope="row">{r.label}</th>
                    {r.values.map((v, i) => (
                      <td key={i}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      );
    case 'terms':
      return (
        <section className="b-terms">
          <h2>Words to know</h2>
          <dl className="terms">
            {block.items.map((t) => (
              <div key={t.term}>
                <dt>{t.term}</dt>
                <dd>{t.meaning}</dd>
              </div>
            ))}
          </dl>
        </section>
      );
    case 'tip':
      return (
        <aside className={`b-tip ${block.kind}`}>
          <b>{block.kind === 'mistake' ? 'Common mistake' : 'In the real world'}</b>
          <p>{block.text}</p>
        </aside>
      );
    case 'quiz':
      return <Quiz questions={block.questions} />;
  }
}

function Quiz({ questions }: { questions: Extract<LessonBlock, { type: 'quiz' }>['questions'] }) {
  const [answers, setAnswers] = useState<(number | null)[]>(() => questions.map(() => null));
  const right = answers.filter((a, i) => a === questions[i]!.answer).length;
  const answered = answers.filter((a) => a !== null).length;

  return (
    <section className="b-quiz">
      <h2>Check your understanding</h2>
      {questions.map((q, qi) => {
        const chosen = answers[qi];
        return (
          <fieldset key={q.question} className="question">
            <legend>{q.question}</legend>
            <div className="options">
              {q.options.map((o, oi) => {
                const state =
                  chosen === null ? '' : oi === q.answer ? ' correct' : oi === chosen ? ' wrong' : ' faded';
                return (
                  <button
                    key={o}
                    className={`option${state}`}
                    disabled={chosen !== null}
                    onClick={() => setAnswers((a) => a.map((x, i) => (i === qi ? oi : x)))}
                  >
                    {o}
                  </button>
                );
              })}
            </div>
            {chosen !== null && (
              <p className={`answer ${chosen === q.answer ? 'right' : 'not-right'}`} role="status">
                <b>{chosen === q.answer ? 'Right.' : 'Not quite.'}</b> {q.why}
              </p>
            )}
          </fieldset>
        );
      })}
      {answered === questions.length && (
        <p className="quiz-score">
          {right} of {questions.length} right.
          {right < questions.length && (
            <button className="link-btn" onClick={() => setAnswers(questions.map(() => null))}>
              Try again
            </button>
          )}
        </p>
      )}
    </section>
  );
}

function Practice({ lesson }: { lesson: Lesson }) {
  const openLevel = useGame((s) => s.openLevel);
  const levels = lesson.practice.map((id) => getLevel(id)).filter((l) => l !== undefined);
  if (!levels.length) return null;
  return (
    <section className="b-practice">
      <h2>Practise it</h2>
      <p>These levels use what you just learned.</p>
      <ul>
        {levels.map((l) => (
          <li key={l.id}>
            <button className="practice-level" onClick={() => openLevel(l.id)}>
              <span className="tile-id">{l.boss ? 'Boss' : l.id}</span>
              <span>{l.title.replace(/^Boss: /, '')}</span>
            </button>
          </li>
        ))}
      </ul>
      {lesson.services.length > 0 && (
        <p className="practice-services">
          Reference cards:{' '}
          {lesson.services.map((k, i) => (
            <span key={k}>
              {i > 0 && ', '}
              <GuideLink kind={k} />
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

function GuideLink({ kind }: { kind: Lesson['services'][number] }) {
  const openGuide = useGame((s) => s.openGuide);
  return (
    <button className="link-btn" onClick={() => openGuide(kind)}>
      {catalogue.get(kind).shortName}
    </button>
  );
}
