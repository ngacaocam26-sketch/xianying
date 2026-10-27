import { useEffect, useState } from 'react';
import StudyScene from './StudyScene';
import { SHAPE_STUDIES } from './shapes';
import type { StudyShape } from './shapes';
import './studies.css';

export default function ShapeStudies() {
  const [rotating, setRotating] = useState(false);
  const [revision, setRevision] = useState(0);
  const [focused, setFocused] = useState<StudyShape | null>(null);
  useEffect(() => {
    const previousTitle = document.title;
    document.title = '显影 · 四种形态试样';
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setFocused(null); };
    window.addEventListener('keydown', onKey);
    return () => { document.title = previousTitle; window.removeEventListener('keydown', onKey); };
  }, []);
  return (
    <main className="shape-studies">
      <header className="studies-header">
        <a className="studies-wordmark" href="/">显影 <span>XIAN YING</span></a>
        <span className="studies-edition">FORM STUDIES <span> / 01</span></span>
      </header>
      <section className="studies-intro" aria-labelledby="studies-title">
        <div><p className="studies-eyebrow">形态试样</p><h1 id="studies-title">四种生长方式</h1></div>
        <p className="studies-conditions">同一银蓝 · 同一视角 · 每件 22,000 颗粒子<br /><span>先看轮廓与空间，再看感受。</span></p>
      </section>
      <div className="studies-toolbar" aria-label="统一观察方式">
        <div className="studies-view-switch" role="group" aria-label="运动方式">
          <button type="button" aria-pressed={!rotating} onClick={() => setRotating(false)}>静态对照</button>
          <button type="button" aria-pressed={rotating} onClick={() => setRotating(true)}>同步转动</button>
        </div>
        <div className="studies-secondary-actions">
          {focused && <button type="button" onClick={() => setFocused(null)}>返回四件对照</button>}
          <button type="button" onClick={() => { setRotating(false); setRevision(value => value + 1); }}>还原视角</button>
        </div>
      </div>
      <section className={`studies-board${focused ? ' is-focused' : ''}`} aria-label="四种形态对照">
        <StudyScene rotating={rotating} revision={revision} focused={focused} />
        {SHAPE_STUDIES.map((study, index) => (
          <article className="shape-study" key={study.id} hidden={focused !== null && focused !== study.id} aria-label={study.name}>
            <div className="study-window" data-study-window={study.id} />
            <div className="study-topline"><span>0{index + 1}</span><span>{study.english}</span></div>
            <button className="study-expand" type="button" aria-label={focused ? `缩小${study.name}` : `放大${study.name}`} onClick={() => setFocused(focused ? null : study.id)}>
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true"><path d={focused ? 'M3 8h5V3m9 9h-5v5M8 8 3 3m9 9 5 5' : 'M3 7V3h4m6 14h4v-4M3 3l5 5m9 9-5-5'} /></svg>
              <span>{focused ? '缩小' : '放大'}</span>
            </button>
            <div className="study-caption"><h2>{study.name}</h2><p>{study.description}</p></div>
          </article>
        ))}
      </section>
      <footer className="studies-footer"><p>四种结构，尚未连接文字与语音。</p><a href="/">回到暗房 <span aria-hidden="true">↗</span></a></footer>
    </main>
  );
}
