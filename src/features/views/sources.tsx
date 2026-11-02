// Sources & method: every dataset with publisher, licence, dates, resolution, method and limits; references; credit;
// the corrections this edition applied (db.corrections, all applied) and the counts of records it did not verify;
// and the open-data sources the weekly pipeline fetched (db.figures.sources), with licence, link and fetch date.

import { Fragment, type ReactNode } from 'react';
import { useDb, useT } from '../../app/useT';
import type { DB, Kind } from '../../data/types';
import type { Bi } from '../../i18n/format';
import { registerStrings } from '../../i18n/strings';
import { Icon } from '../../ui/Icon';

registerStrings({
  ar: {
    'sr.credit': 'الإسناد والترخيص',
    'sr.creditBody': 'جُمعت البيانات في الأطلس الأصلي {link} وتُنشر بترخيص CC-BY-4.0، والحدود من Natural Earth وهي ملكية عامة.',
    'sr.asOf': 'وضع النزاعات محدّث حتى {date}.',
    'sr.edition': 'تعيد هذه النسخة تصميم الواجهة فقط، ولا تتحقّق بشكل مستقل من حقول الوضع الحالي.',
    'sr.datasets': 'مجموعات البيانات',
    'sr.publisher': 'الجهة',
    'sr.license': 'الترخيص',
    'sr.published': 'تاريخ النشر',
    'sr.retrieved': 'آخر استرجاع',
    'sr.file': 'الملف',
    'sr.resolution': 'الدقة المكانية',
    'sr.method': 'المنهجية',
    'sr.limits': 'القيود',
    'sr.fields': 'الحقول المستخدمة',
    'sr.primary': 'مصادر أولية موصى بها',
    'sr.open': 'صفحة المصدر',
    'sr.derived': 'محسوب في هذه النسخة',
    'sr.d1': 'التنوّع الديني',
    'sr.d1t': 'مؤشر جيني–سيمبسون على حصص التقاليد الدينية: واحد ناقص مجموع مربّعات الحصص. صفر يعني تقليداً واحداً، وكلما ارتفع زاد التنوّع.',
    'sr.d2': 'الجوار',
    'sr.d2t': 'أقرب نقاط تسمية الدول داخل الإقليم الفرعي نفسه. هذا تقريب للقرب الجغرافي، لا قائمة حدود رسمية.',
    'sr.d3': 'أعداد الارتباط',
    'sr.d3t': 'عدد السجلات المرتبطة بالدولة في هذا الأطلس (نزاعات، روابط، أحداث، موارد). تقيس تغطية الأطلس لا درجة الخطر.',
    'sr.refs': 'المراجع',
    'sr.errata': 'تصحيحات هذه النسخة',
    'sr.errataLede': 'البيانات الأصلية منشورة بترخيص CC-BY-4.0، وهذه هي التغييرات التي أدخلتها هذه النسخة عليها.',
    'sr.uvTitle': 'علامة «لم تتحقّق منها هذه النسخة»',
    'sr.unverified': 'تنقل هذه النسخة الوضع الحالي وأحدث التطوّرات من الأطلس الأصلي (حتى {d}) دون أن تدقّقها بصورة مستقلة مقابل مصادر أولية، وتضع هذه العلامة على كل سجلّ يتضمّن تطوّرات من هذا النوع: في لوحة التفاصيل شارة، وفي الخط الزمني حدّ متقطّع حول نقطة الحدث. عدد السجلات المعلَّمة: {list}.',
    'sr.k.conflict': 'نزاعات', 'sr.k.event': 'أحداث', 'sr.k.choke': 'مضائق وممرات', 'sr.k.country': 'دول',
    'sr.gen': 'بيانات مفتوحة تُحدَّث أسبوعياً',
    'sr.genLede': 'أرقام السكان والناتج المحلي واللاجئين والنازحين وضحايا النزاعات تأتي من هذه المصادر المفتوحة عبر تحديث آلي أسبوعي يراجعه المحرّرون قبل نشره، ويظهر بجانب كل رقم مصدره وسنته. حين لا يتوفّر رقم من هذه المصادر يعرض الأطلس رقم Natural Earth.',
    'sr.fetched': 'تاريخ الجلب',
    'sr.cite': 'طريقة الاستشهاد',
  },
  en: {
    'sr.credit': 'Credit and licence',
    'sr.creditBody': 'The data was compiled by the original atlas {link} and is published under CC-BY-4.0; borders are from Natural Earth, in the public domain.',
    'sr.asOf': 'Conflict status as of {date}.',
    'sr.edition': 'This edition redesigns the interface only and does not independently verify the current-status fields.',
    'sr.datasets': 'Datasets',
    'sr.publisher': 'Publisher',
    'sr.license': 'Licence',
    'sr.published': 'Published',
    'sr.retrieved': 'Last retrieved',
    'sr.file': 'File',
    'sr.resolution': 'Spatial resolution',
    'sr.method': 'Method',
    'sr.limits': 'Limitations',
    'sr.fields': 'Fields used',
    'sr.primary': 'Recommended primary sources',
    'sr.open': 'Source page',
    'sr.derived': 'Derived in this edition',
    'sr.d1': 'Religious diversity',
    'sr.d1t': 'The Gini–Simpson index over religious-tradition shares: one minus the sum of squared shares. Zero means a single tradition; higher means more diverse.',
    'sr.d2': 'Neighbours',
    'sr.d2t': 'The nearest country label points within the same subregion. A proximity approximation, not an official border list.',
    'sr.d3': 'Linked-record counts',
    'sr.d3t': 'The number of records linked to a state in this atlas (conflicts, ties, events, resources). They measure the atlas’s coverage, not risk.',
    'sr.refs': 'References',
    'sr.errata': 'Corrections in this edition',
    'sr.errataLede': 'The original data is published under CC-BY-4.0; these are the changes this edition made to it.',
    'sr.uvTitle': 'The “not independently verified” mark',
    'sr.unverified': 'This edition carries the current status and recent developments over from the original atlas (as of {d}) without checking them independently against primary sources, and marks every record that includes such developments: a badge in the details panel, a dashed outline around the event’s dot in the timeline. Marked records: {list}.',
    'sr.k.conflict': 'conflicts', 'sr.k.event': 'events', 'sr.k.choke': 'chokepoints', 'sr.k.country': 'states',
    'sr.gen': 'Open data, refreshed weekly',
    'sr.genLede': 'Population, GDP, refugee, displacement and conflict-death figures come from these open sources through an automatic weekly update that the editors review before it is published. Every figure shows its source and year. Where these sources have no figure, the atlas shows Natural Earth’s.',
    'sr.fetched': 'Fetched',
    'sr.cite': 'How to cite',
  },
});

type Named = Partial<Bi> | string | null | undefined;
interface DatasetMeta {
  id: string; file?: string; title?: Named; publisher?: Named; url?: string; license?: Named; published?: string; lastRetrieved?: string;
  resolution?: Named; methodology?: Named; limitations?: Named; fieldsUsed?: string[]; recommendedPrimary?: string[];
}
interface ReferenceMeta { id: string; name?: Named; url?: string; role?: Named }

const ORIGINAL = { url: 'https://claude.ai/artifact/7Y8KPakRKzrUtZYxjCwJai', title: 'الأطلس الجيوسياسي والعرقي الديني العالمي' };
const safeUrl = (u: unknown) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : null);

// The unverified flags by kind, in v2's order (v2 kept them as id lists; the data now carries them on the records).
const UV_KINDS = ['conflict', 'event', 'choke', 'country'] as const satisfies readonly Kind[];
function idsOf(db: DB, kind: (typeof UV_KINDS)[number]): string[] {
  switch (kind) {
    case 'conflict': return db.conflicts.map((c) => c.id);
    case 'event': return db.timeline.events.map((e) => e.id);
    case 'choke': return db.chokepoints.map((p) => p.id);
    case 'country': return [...db.countries.keys()];
  }
}

function Ext({ url, label }: { url: unknown; label: string }) {
  const href = safeUrl(url);
  return href ? <a href={href} target="_blank" rel="noopener">{label}<Icon name="external" size={13} /></a> : <>{label}</>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

function Card({ d }: { d: DatasetMeta }) {
  const db = useDb();
  const { t, fmt, pick } = useT();
  const L = pick as (o: Named) => string;
  const ref = (id: string) => {
    const r = db.referenceById.get(id) as ReferenceMeta | undefined;
    return r ? <Ext url={r.url} label={L(r.name)} /> : <>{id}</>;
  };
  const license = L(d.license), resolution = L(d.resolution), method = L(d.methodology), limits = L(d.limitations);
  const link = safeUrl(d.url);
  return (
    <article className="src-card" aria-labelledby={`src-${d.id}`}>
      <header className="src-card-h">
        <h4 id={`src-${d.id}`}>{L(d.title)}</h4>
        <p className="src-pub">{L(d.publisher)}</p>
      </header>
      <dl className="src-meta">
        {license && <Row label={t('sr.license')}>{license}</Row>}
        <Row label={t('sr.published')}>{fmt.date(d.published)}</Row>
        <Row label={t('sr.retrieved')}>{fmt.date(d.lastRetrieved)}</Row>
        <Row label={t('sr.file')}><span className="num">{d.file ?? ''}</span></Row>
      </dl>
      <dl className="src-text">
        {resolution && <Row label={t('sr.resolution')}>{resolution}</Row>}
        {method && <Row label={t('sr.method')}>{method}</Row>}
        {limits && <Row label={t('sr.limits')}>{limits}</Row>}
        {!!d.fieldsUsed?.length && (
          <Row label={t('sr.fields')}><ul className="src-fields">{d.fieldsUsed.map((f, i) => <li key={i}>{f}</li>)}</ul></Row>
        )}
        {!!d.recommendedPrimary?.length && (
          <Row label={t('sr.primary')}>
            {d.recommendedPrimary.map((id, i) => <Fragment key={i}>{i > 0 && <span className="src-sep">، </span>}{ref(id)}</Fragment>)}
          </Row>
        )}
      </dl>
      {link && <a className="src-link" href={link} target="_blank" rel="noopener">{t('sr.open')}<Icon name="external" size={14} /></a>}
    </article>
  );
}

/** The generated open-data sources (db.figures.sources); nothing until the pipeline has produced a file. */
function OpenData() {
  const db = useDb();
  const { t, fmt } = useT();
  const list = db.figures.sources;
  if (!list.length) return null;
  return (
    <section aria-labelledby="src-gen-h">
      <h3 className="vw-h3" id="src-gen-h">{t('sr.gen')} <span className="n">{list.length}</span></h3>
      <p className="vw-note">{t('sr.genLede')}</p>
      <ul className="src-refs src-gen">
        {list.map((s) => (
          <li key={s.id}>
            <span className="src-ref-n"><Ext url={s.url} label={s.name} /></span>
            <span className="src-ref-r">{t('sr.license')}: {s.licence} · {t('sr.fetched')}: {fmt.date(s.fetchedAt.slice(0, 10))}</span>
            {s.citation && <span className="src-ref-r" lang="en" dir="ltr">{t('sr.cite')}: {s.citation}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SourcesView() {
  const db = useDb();
  const { t, fmt, pick, lang } = useT();
  const L = pick as (o: Named) => string;
  const S = db.sources as { note?: Named; datasets: DatasetMeta[]; references: ReferenceMeta[] };
  const errata = db.corrections;
  const uv = UV_KINDS.map((k) => [k, idsOf(db, k).filter((id) => db.isUnverified(k, id)).length] as const).filter(([, n]) => n > 0);
  const uvList = uv.map(([k, n]) => `${t('sr.k.' + k)} ${n}`).join(lang === 'ar' ? '، ' : ', ');
  const [pre, post = ''] = t('sr.creditBody').split('{link}');

  return (
    <div className="src">
      <p className="src-lede">{L(S.note)}</p>
      <section className="src-credit" aria-labelledby="src-credit-h">
        <h3 className="vw-h3" id="src-credit-h">{t('sr.credit')}</h3>
        <p>{pre}<a href={ORIGINAL.url} target="_blank" rel="noopener" lang="ar">«{ORIGINAL.title}»</a>{post}</p>
        <p>{t('sr.asOf', { date: fmt.date(db.conflictsAsOf) })} {t('sr.edition')}</p>
      </section>
      <OpenData />
      {uv.length > 0 && (
        <section className="src-uv" aria-labelledby="src-uv-h">
          <h3 className="vw-h3" id="src-uv-h"><Icon name="info" size={15} />{t('sr.uvTitle')}</h3>
          <p>{t('sr.unverified', { d: fmt.date(db.conflictsAsOf), list: uvList })}</p>
        </section>
      )}
      {errata.length > 0 && (
        <section aria-labelledby="src-er-h">
          <h3 className="vw-h3" id="src-er-h">{t('sr.errata')} <span className="n">{errata.length}</span></h3>
          <p className="vw-note src-er-lede">{t('sr.errataLede')}</p>
          <dl className="src-derived">{errata.map((e) => <div key={e.id}><dt>{L(e.where)}</dt><dd>{L(e.what)}</dd></div>)}</dl>
        </section>
      )}
      <section aria-labelledby="src-ds-h">
        <h3 className="vw-h3" id="src-ds-h">{t('sr.datasets')} <span className="n">{S.datasets.length}</span></h3>
        <div className="src-grid">{S.datasets.map((d) => <Card key={d.id} d={d} />)}</div>
      </section>
      <section aria-labelledby="src-dv-h">
        <h3 className="vw-h3" id="src-dv-h">{t('sr.derived')}</h3>
        <dl className="src-derived">
          {['d1', 'd2', 'd3'].map((k) => <div key={k}><dt>{t('sr.' + k)}</dt><dd>{t(`sr.${k}t`)}</dd></div>)}
        </dl>
      </section>
      <section aria-labelledby="src-rf-h">
        <h3 className="vw-h3" id="src-rf-h">{t('sr.refs')} <span className="n">{S.references.length}</span></h3>
        <ul className="src-refs">
          {S.references.map((r) => (
            <li key={r.id}><span className="src-ref-n"><Ext url={r.url} label={L(r.name)} /></span><span className="src-ref-r">{L(r.role)}</span></li>
          ))}
        </ul>
      </section>
    </div>
  );
}
